use actix_cors::Cors;
use actix_files::Files;
use actix_multipart::Multipart;
use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer, Responder};
use actix_ws::Message;
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::{DateTime, Utc};
use futures_util::{StreamExt, TryStreamExt};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex, RwLock};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

const JWT_SECRET: &[u8] = b"lomba-coding-secret-key-2024";
const MAX_FILE_SIZE: u64 = 300 * 1024 * 1024; // 300MB
const TIMER_BROADCAST_INTERVAL_MS: u64 = 250; // Broadcast setiap 250ms untuk realtime

// === Data Structures ===

#[derive(Clone, Serialize, Deserialize)]
pub struct Meja {
    pub id: String,
    pub nomor: u32,
    pub kode: String,
    pub nama_peserta: Option<String>,
    pub files: Vec<FileInfo>,
    pub last_upload: Option<DateTime<Utc>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub id: String,
    pub filename: String,
    pub size: u64,
    pub uploaded_at: DateTime<Utc>,
    pub path: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct TimerState {
    pub is_running: bool,
    pub duration_seconds: i64,
    pub remaining_seconds: i64,
    pub started_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SoalFile {
    pub id: String,
    pub filename: String,
    pub path: String,
    pub uploaded_at: DateTime<Utc>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AppState {
    pub meja_list: HashMap<String, Meja>,
    pub timer: TimerState,
    pub soal_files: Vec<SoalFile>,
    pub lomba_title: String,
}

pub struct SharedState {
    pub state: RwLock<AppState>,
    pub broadcast_tx: broadcast::Sender<String>,
    pub db: Mutex<Connection>,
}

// === Auth Structures ===

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
    pub role: String,
}

#[derive(Deserialize)]
pub struct LoginAdminRequest {
    pub username: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    pub old_password: String,
    pub new_password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub success: bool,
    pub token: Option<String>,
    pub error: Option<String>,
}

// === API Request/Response ===

#[derive(Deserialize)]
pub struct GenerateMejaRequest {
    pub jumlah: u32,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub kode: String,
}

#[derive(Deserialize)]
pub struct SetTimerRequest {
    pub duration_minutes: i64,
}

#[derive(Deserialize)]
pub struct AdjustTimerRequest {
    pub seconds: i64,
}

#[derive(Deserialize)]
pub struct UpdatePesertaRequest {
    pub nama: String,
}

#[derive(Serialize)]
pub struct ArchiveContent {
    pub files: Vec<ArchiveEntry>,
}

#[derive(Serialize)]
pub struct ArchiveEntry {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct FilePreview {
    pub filename: String,
    pub content: Option<String>,
    pub is_text: bool,
    pub size: u64,
}

// === Database Functions ===

fn init_database(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS admin (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS meja (
            id TEXT PRIMARY KEY,
            nomor INTEGER NOT NULL,
            kode TEXT UNIQUE NOT NULL,
            nama_peserta TEXT
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            meja_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            size INTEGER NOT NULL,
            uploaded_at TEXT NOT NULL,
            path TEXT NOT NULL,
            FOREIGN KEY (meja_id) REFERENCES meja(id)
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS soal (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            path TEXT NOT NULL,
            uploaded_at TEXT NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS timer (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            is_running INTEGER NOT NULL DEFAULT 0,
            duration_seconds INTEGER NOT NULL DEFAULT 3600,
            remaining_seconds INTEGER NOT NULL DEFAULT 3600,
            started_at TEXT
        )",
        [],
    )?;

    let default_hash = hash("admin123", DEFAULT_COST).unwrap();
    conn.execute(
        "INSERT OR IGNORE INTO admin (id, username, password_hash) VALUES (1, 'admin', ?1)",
        params![default_hash],
    )?;

    conn.execute(
        "INSERT OR IGNORE INTO timer (id, is_running, duration_seconds, remaining_seconds) VALUES (1, 0, 3600, 3600)",
        [],
    )?;

    Ok(())
}

fn load_state_from_db(conn: &Connection) -> AppState {
    let mut meja_list: HashMap<String, Meja> = HashMap::new();

    if let Ok(mut stmt) = conn.prepare("SELECT id, nomor, kode, nama_peserta FROM meja") {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok(Meja {
                id: row.get(0)?,
                nomor: row.get(1)?,
                kode: row.get(2)?,
                nama_peserta: row.get(3)?,
                files: vec![],
                last_upload: None,
            })
        }) {
            for meja in rows.flatten() {
                meja_list.insert(meja.id.clone(), meja);
            }
        }
    }

    if let Ok(mut stmt) = conn.prepare("SELECT id, meja_id, filename, size, uploaded_at, path FROM files ORDER BY uploaded_at DESC") {
        if let Ok(rows) = stmt.query_map([], |row| {
            let uploaded_at_str: String = row.get(4)?;
            let uploaded_at = DateTime::parse_from_rfc3339(&uploaded_at_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            Ok((
                row.get::<_, String>(1)?,
                FileInfo {
                    id: row.get(0)?,
                    filename: row.get(2)?,
                    size: row.get(3)?,
                    uploaded_at,
                    path: row.get(5)?,
                },
            ))
        }) {
            for result in rows.flatten() {
                let (meja_id, file) = result;
                if let Some(meja) = meja_list.get_mut(&meja_id) {
                    if meja.last_upload.is_none() || meja.last_upload.unwrap() < file.uploaded_at {
                        meja.last_upload = Some(file.uploaded_at);
                    }
                    meja.files.push(file);
                }
            }
        }
    }

    let mut soal_files = vec![];
    if let Ok(mut stmt) = conn.prepare("SELECT id, filename, path, uploaded_at FROM soal") {
        if let Ok(rows) = stmt.query_map([], |row| {
            let uploaded_at_str: String = row.get(3)?;
            let uploaded_at = DateTime::parse_from_rfc3339(&uploaded_at_str)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            Ok(SoalFile {
                id: row.get(0)?,
                filename: row.get(1)?,
                path: row.get(2)?,
                uploaded_at,
            })
        }) {
            soal_files = rows.flatten().collect();
        }
    }

    let timer = if let Ok(mut stmt) = conn.prepare("SELECT is_running, duration_seconds, remaining_seconds, started_at FROM timer WHERE id = 1") {
        stmt.query_row([], |row| {
            let started_at_str: Option<String> = row.get(3)?;
            let started_at = started_at_str.and_then(|s| {
                DateTime::parse_from_rfc3339(&s)
                    .map(|dt| dt.with_timezone(&Utc))
                    .ok()
            });
            Ok(TimerState {
                is_running: row.get::<_, i32>(0)? != 0,
                duration_seconds: row.get(1)?,
                remaining_seconds: row.get(2)?,
                started_at,
            })
        }).unwrap_or(TimerState {
            is_running: false,
            duration_seconds: 3600,
            remaining_seconds: 3600,
            started_at: None,
        })
    } else {
        TimerState {
            is_running: false,
            duration_seconds: 3600,
            remaining_seconds: 3600,
            started_at: None,
        }
    };

    AppState {
        meja_list,
        timer,
        soal_files,
        lomba_title: "Lomba Coding".to_string(),
    }
}

fn save_timer_to_db(conn: &Connection, timer: &TimerState) {
    let started_at = timer.started_at.map(|dt| dt.to_rfc3339());
    conn.execute(
        "UPDATE timer SET is_running = ?1, duration_seconds = ?2, remaining_seconds = ?3, started_at = ?4 WHERE id = 1",
        params![timer.is_running as i32, timer.duration_seconds, timer.remaining_seconds, started_at],
    ).ok();
}

// === Helper Functions ===

fn generate_kode() -> String {
    let chars: Vec<char> = "abcdefghijklmnopqrstuvwxyz0123456789".chars().collect();
    let mut rng = rand::thread_rng();
    (0..6).map(|_| chars[rng.gen_range(0..chars.len())]).collect()
}

fn get_storage_path() -> PathBuf {
    let path = PathBuf::from("./storage");
    std::fs::create_dir_all(&path).ok();
    path
}

fn get_uploads_path(meja_id: &str) -> PathBuf {
    let path = get_storage_path().join("uploads").join(meja_id);
    std::fs::create_dir_all(&path).ok();
    path
}

fn get_soal_path() -> PathBuf {
    let path = get_storage_path().join("soal");
    std::fs::create_dir_all(&path).ok();
    path
}

async fn broadcast_state(shared: &SharedState) {
    let state = shared.state.read().await;
    if let Ok(json) = serde_json::to_string(&*state) {
        let _ = shared.broadcast_tx.send(json);
    }
}

// Broadcast hanya timer state untuk performa lebih baik
async fn broadcast_timer_only(shared: &SharedState) {
    let state = shared.state.read().await;
    let timer_msg = serde_json::json!({
        "timer": state.timer,
        "meja_list": state.meja_list,
        "soal_files": state.soal_files,
        "lomba_title": state.lomba_title
    });
    if let Ok(json) = serde_json::to_string(&timer_msg) {
        let _ = shared.broadcast_tx.send(json);
    }
}

fn create_token(username: &str, role: &str) -> Option<String> {
    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::hours(24))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: username.to_string(),
        exp: expiration,
        role: role.to_string(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(JWT_SECRET),
    )
    .ok()
}

fn verify_admin_token(req: &HttpRequest) -> bool {
    let auth_header = req.headers().get("Authorization");
    if let Some(auth_value) = auth_header {
        if let Ok(auth_str) = auth_value.to_str() {
            if auth_str.starts_with("Bearer ") {
                let token = &auth_str[7..];
                if let Ok(token_data) = decode::<Claims>(
                    token,
                    &DecodingKey::from_secret(JWT_SECRET),
                    &Validation::default(),
                ) {
                    return token_data.claims.role == "admin";
                }
            }
        }
    }
    false
}

// === Auth Handlers ===

async fn admin_login(
    shared: web::Data<Arc<SharedState>>,
    body: web::Json<LoginAdminRequest>,
) -> impl Responder {
    let db = shared.db.lock().await;

    let result: Result<String, _> = db.query_row(
        "SELECT password_hash FROM admin WHERE username = ?1",
        params![body.username],
        |row| row.get(0),
    );

    match result {
        Ok(hash) => {
            if verify(&body.password, &hash).unwrap_or(false) {
                if let Some(token) = create_token(&body.username, "admin") {
                    return HttpResponse::Ok().json(AuthResponse {
                        success: true,
                        token: Some(token),
                        error: None,
                    });
                }
            }
        }
        Err(_) => {}
    }

    HttpResponse::Unauthorized().json(AuthResponse {
        success: false,
        token: None,
        error: Some("Username atau password salah".to_string()),
    })
}

async fn verify_token(req: HttpRequest) -> impl Responder {
    if verify_admin_token(&req) {
        HttpResponse::Ok().json(serde_json::json!({"valid": true}))
    } else {
        HttpResponse::Unauthorized().json(serde_json::json!({"valid": false}))
    }
}

async fn change_password(
    req: HttpRequest,
    shared: web::Data<Arc<SharedState>>,
    body: web::Json<ChangePasswordRequest>,
) -> impl Responder {
    if !verify_admin_token(&req) {
        return HttpResponse::Unauthorized().json(serde_json::json!({"error": "Unauthorized"}));
    }

    let db = shared.db.lock().await;

    let result: Result<String, _> = db.query_row(
        "SELECT password_hash FROM admin WHERE id = 1",
        [],
        |row| row.get(0),
    );

    match result {
        Ok(current_hash) => {
            if verify(&body.old_password, &current_hash).unwrap_or(false) {
                if let Ok(new_hash) = hash(&body.new_password, DEFAULT_COST) {
                    if db.execute(
                        "UPDATE admin SET password_hash = ?1 WHERE id = 1",
                        params![new_hash],
                    ).is_ok() {
                        return HttpResponse::Ok().json(serde_json::json!({"success": true}));
                    }
                }
            }
            HttpResponse::BadRequest().json(serde_json::json!({"error": "Password lama salah"}))
        }
        Err(_) => HttpResponse::InternalServerError().json(serde_json::json!({"error": "Database error"})),
    }
}

// === Admin API Handlers ===

async fn get_state(shared: web::Data<Arc<SharedState>>) -> impl Responder {
    let state = shared.state.read().await;
    HttpResponse::Ok().json(&*state)
}

async fn generate_meja(
    req: HttpRequest,
    shared: web::Data<Arc<SharedState>>,
    body: web::Json<GenerateMejaRequest>,
) -> impl Responder {
    if !verify_admin_token(&req) {
        return HttpResponse::Unauthorized().json(serde_json::json!({"error": "Unauthorized"}));
    }

    let mut state = shared.state.write().await;
    let db = shared.db.lock().await;

    db.execute("DELETE FROM files", []).ok();
    db.execute("DELETE FROM meja", []).ok();

    state.meja_list.clear();

    for i in 1..=body.jumlah {
        let id = Uuid::new_v4().to_string();
        let kode = generate_kode();

        db.execute(
            "INSERT INTO meja (id, nomor, kode) VALUES (?1, ?2, ?3)",
            params![id, i, kode],
        ).ok();

        let meja = Meja {
            id: id.clone(),
            nomor: i,
            kode,
            nama_peserta: None,
            files: vec![],
            last_upload: None,
        };
        state.meja_list.insert(id, meja);
    }

    drop(db);
    drop(state);
    broadcast_state(&shared).await;

    HttpResponse::Ok().json(serde_json::json!({"success": true}))
}

async fn set_timer(
    req: HttpRequest,
    shared: web::Data<Arc<SharedState>>,
    body: web::Json<SetTimerRequest>,
) -> impl Responder {
    if !verify_admin_token(&req) {
        return HttpResponse::Unauthorized().json(serde_json::json!({"error": "Unauthorized"}));
    }

    let mut state = shared.state.write().await;
    state.timer.duration_seconds = body.duration_minutes * 60;
    state.timer.remaining_seconds = state.timer.duration_seconds;
    state.timer.is_running = false;
    state.timer.started_at = None;

    let db = shared.db.lock().await;
    save_timer_to_db(&db, &state.timer);

    drop(db);
    drop(state);
    broadcast_state(&shared).await;

    HttpResponse::Ok().json(serde_json::json!({"success": true}))
}

async fn start_timer(
    req: HttpRequest,
    shared: web::Data<Arc<SharedState>>,
) -> impl Responder {
    if !verify_admin_token(&req) {
        return HttpResponse::Unauthorized().json(serde_json::json!({"error": "Unauthorized"}));
    }

    let mut state = shared.state.write().await;
    if !state.timer.is_running && state.timer.remaining_seconds > 0 {
        state.timer.is_running = true;
        state.timer.started_at = Some(Utc::now());

        let db = shared.db.lock().await;
        save_timer_to_db(&db, &state.timer);
    }

    drop(state);
    broadcast_state(&shared).await;

    HttpResponse::Ok().json(serde_json::json!({"success": true}))
}

async fn pause_timer(
    req: HttpRequest,
    shared: web::Data<Arc<SharedState>>,
) -> impl Responder {
    if !verify_admin_token(&req) {
        return HttpResponse::Unauthorized().json(serde_json::json!({"error": "Unauthorized"}));
    }

    let mut state = shared.state.write().await;
    if state.timer.is_running {
        if let Some(started) = state.timer.started_at {
            let elapsed = Utc::now().signed_duration_since(started).num_seconds();
            state.timer.remaining_seconds = (state.timer.remaining_seconds - elapsed).max(0);
        }
        state.timer.is_running = false;
        state.timer.started_at = None;

        let db = shared.db.lock().await;
        save_timer_to_db(&db, &state.timer);
    }

    drop(state);
    broadcast_state(&shared).await;

    HttpResponse::Ok().json(serde_json::json!({"success": true}))
}

async fn reset_timer(
    req: HttpRequest,
    shared: web::Data<Arc<SharedState>>,
) -> impl Responder {
    if !verify_admin_token(&req) {
        return HttpResponse::Unauthorized().json(serde_json::json!({"error": "Unauthorized"}));
    }

    let mut state = shared.state.write().await;
    state.timer.remaining_seconds = state.timer.duration_seconds;
    state.timer.is_running = false;
    state.timer.started_at = None;

    let db = shared.db.lock().await;
    save_timer_to_db(&db, &state.timer);

    drop(db);
    drop(state);
    broadcast_state(&shared).await;

    HttpResponse::Ok().json(serde_json::json!({"success": true}))
}

async fn adjust_timer(
    req: HttpRequest,
    shared: web::Data<Arc<SharedState>>,
    body: web::Json<AdjustTimerRequest>,
) -> impl Responder {
    if !verify_admin_token(&req) {
        return HttpResponse::Unauthorized().json(serde_json::json!({"error": "Unauthorized"}));
    }

    let mut state = shared.state.write().await;

    if state.timer.is_running {
        if let Some(started) = state.timer.started_at {
            let elapsed = chrono::Utc::now().signed_duration_since(started).num_seconds();
            let current_remaining = state.timer.duration_seconds - elapsed;
            state.timer.duration_seconds = current_remaining + body.seconds + elapsed;
        }
    } else {
        state.timer.remaining_seconds = (state.timer.remaining_seconds + body.seconds).max(0);
        state.timer.duration_seconds = state.timer.remaining_seconds;
    }

    let db = shared.db.lock().await;
    save_timer_to_db(&db, &state.timer);

    drop(db);
    drop(state);
    broadcast_state(&shared).await;

    HttpResponse::Ok().json(serde_json::json!({"success": true}))
}

async fn upload_soal(
    req: HttpRequest,
    shared: web::Data<Arc<SharedState>>,
    mut payload: Multipart,
) -> impl Responder {
    if !verify_admin_token(&req) {
        return HttpResponse::Unauthorized().json(serde_json::json!({"error": "Unauthorized"}));
    }

    while let Ok(Some(mut field)) = payload.try_next().await {
        let content_disposition = field.content_disposition();
        let filename = content_disposition
            .and_then(|cd| cd.get_filename().map(|f| sanitize_filename::sanitize(f)))
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let filepath = get_soal_path().join(&filename);
        
        // Gunakan async file I/O dengan buffer besar
        let mut file = match tokio::fs::File::create(&filepath).await {
            Ok(f) => tokio::io::BufWriter::with_capacity(256 * 1024, f), // 256KB buffer
            Err(_) => return HttpResponse::InternalServerError().json(serde_json::json!({"error": "Failed to create file"})),
        };

        // Collect chunks ke buffer sebelum write
        let mut buffer = Vec::with_capacity(1024 * 1024); // 1MB pre-allocated
        while let Some(chunk) = field.next().await {
            if let Ok(data) = chunk {
                buffer.extend_from_slice(&data);
                // Flush ke disk setiap 4MB
                if buffer.len() >= 4 * 1024 * 1024 {
                    if file.write_all(&buffer).await.is_err() {
                        return HttpResponse::InternalServerError().json(serde_json::json!({"error": "Failed to write file"}));
                    }
                    buffer.clear();
                }
            }
        }
        // Write remaining buffer
        if !buffer.is_empty() {
            if file.write_all(&buffer).await.is_err() {
                return HttpResponse::InternalServerError().json(serde_json::json!({"error": "Failed to write file"}));
            }
        }
        file.flush().await.ok();

        let id = Uuid::new_v4().to_string();
        let uploaded_at = Utc::now();
        let path_str = filepath.to_string_lossy().to_string();

        let db = shared.db.lock().await;
        db.execute(
            "INSERT INTO soal (id, filename, path, uploaded_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, filename, path_str, uploaded_at.to_rfc3339()],
        ).ok();
        drop(db);

        let mut state = shared.state.write().await;
        state.soal_files.push(SoalFile {
            id,
            filename: filename.clone(),
            path: path_str,
            uploaded_at,
        });

        drop(state);
        broadcast_state(&shared).await;
    }

    HttpResponse::Ok().json(serde_json::json!({"success": true}))
}

async fn delete_soal(
    req: HttpRequest,
    shared: web::Data<Arc<SharedState>>,
    path: web::Path<String>,
) -> impl Responder {
    if !verify_admin_token(&req) {
        return HttpResponse::Unauthorized().json(serde_json::json!({"error": "Unauthorized"}));
    }

    let soal_id = path.into_inner();
    let mut state = shared.state.write().await;

    if let Some(idx) = state.soal_files.iter().position(|s| s.id == soal_id) {
        let soal = state.soal_files.remove(idx);
        tokio::fs::remove_file(&soal.path).await.ok();

        let db = shared.db.lock().await;
        db.execute("DELETE FROM soal WHERE id = ?1", params![soal_id]).ok();
    }

    drop(state);
    broadcast_state(&shared).await;

    HttpResponse::Ok().json(serde_json::json!({"success": true}))
}

// === Export Handler ===

async fn export_meja(
    req: HttpRequest,
    shared: web::Data<Arc<SharedState>>,
) -> impl Responder {
    if !verify_admin_token(&req) {
        return HttpResponse::Unauthorized().json(serde_json::json!({"error": "Unauthorized"}));
    }

    let state = shared.state.read().await;
    let mut meja_list: Vec<&Meja> = state.meja_list.values().collect();
    meja_list.sort_by_key(|m| m.nomor);

    let mut csv = String::from("Nomor Meja,Kode,Nama Peserta,Jumlah File,Status\n");
    for meja in &meja_list {
        let status = if meja.files.is_empty() { "Belum Upload" } else { "Sudah Upload" };
        csv.push_str(&format!(
            "Meja {},\"{}\",\"{}\",{},{}\n",
            meja.nomor,
            meja.kode,
            meja.nama_peserta.as_deref().unwrap_or("-"),
            meja.files.len(),
            status
        ));
    }

    HttpResponse::Ok()
        .content_type("text/csv")
        .insert_header(("Content-Disposition", "attachment; filename=\"daftar_meja.csv\""))
        .body(csv)
}

async fn export_meja_json(
    req: HttpRequest,
    shared: web::Data<Arc<SharedState>>,
) -> impl Responder {
    if !verify_admin_token(&req) {
        return HttpResponse::Unauthorized().json(serde_json::json!({"error": "Unauthorized"}));
    }

    let state = shared.state.read().await;
    let mut meja_list: Vec<_> = state.meja_list.values().map(|m| {
        serde_json::json!({
            "nomor": m.nomor,
            "kode": m.kode,
            "nama_peserta": m.nama_peserta,
            "jumlah_file": m.files.len(),
            "status": if m.files.is_empty() { "Belum Upload" } else { "Sudah Upload" }
        })
    }).collect();
    meja_list.sort_by_key(|m| m["nomor"].as_u64().unwrap_or(0));

    HttpResponse::Ok().json(meja_list)
}

// === Participant API Handlers ===

async fn login_peserta(
    shared: web::Data<Arc<SharedState>>,
    body: web::Json<LoginRequest>,
) -> impl Responder {
    let state = shared.state.read().await;

    for meja in state.meja_list.values() {
        if meja.kode == body.kode {
            return HttpResponse::Ok().json(serde_json::json!({
                "success": true,
                "meja": meja
            }));
        }
    }

    HttpResponse::Unauthorized().json(serde_json::json!({
        "success": false,
        "error": "Kode tidak valid"
    }))
}

async fn update_peserta(
    shared: web::Data<Arc<SharedState>>,
    path: web::Path<String>,
    body: web::Json<UpdatePesertaRequest>,
) -> impl Responder {
    let meja_id = path.into_inner();
    let mut state = shared.state.write().await;

    if let Some(meja) = state.meja_list.get_mut(&meja_id) {
        meja.nama_peserta = Some(body.nama.clone());

        let db = shared.db.lock().await;
        db.execute(
            "UPDATE meja SET nama_peserta = ?1 WHERE id = ?2",
            params![body.nama, meja_id],
        ).ok();

        drop(db);
        drop(state);
        broadcast_state(&shared).await;
        return HttpResponse::Ok().json(serde_json::json!({"success": true}));
    }

    HttpResponse::NotFound().json(serde_json::json!({"error": "Meja not found"}))
}

async fn upload_file(
    shared: web::Data<Arc<SharedState>>,
    path: web::Path<String>,
    mut payload: Multipart,
) -> impl Responder {
    let meja_id = path.into_inner();

    {
        let state = shared.state.read().await;
        if !state.meja_list.contains_key(&meja_id) {
            return HttpResponse::NotFound().json(serde_json::json!({"error": "Meja not found"}));
        }

        let remaining = if state.timer.is_running {
            if let Some(started) = state.timer.started_at {
                let elapsed = Utc::now().signed_duration_since(started).num_seconds();
                (state.timer.duration_seconds - elapsed).max(0)
            } else {
                state.timer.remaining_seconds
            }
        } else {
            state.timer.remaining_seconds
        };

        if remaining <= 0 && state.timer.duration_seconds > 0 {
            return HttpResponse::Forbidden().json(serde_json::json!({
                "error": "Waktu telah habis!!",
                "time_expired": true
            }));
        }
    }

    let upload_path = get_uploads_path(&meja_id);
    let mut uploaded_files = vec![];

    while let Ok(Some(mut field)) = payload.try_next().await {
        let content_disposition = field.content_disposition();
        let filename = content_disposition
            .and_then(|cd| cd.get_filename().map(|f| sanitize_filename::sanitize(f)))
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let filepath = upload_path.join(&filename);
        
        // Async file I/O dengan buffer besar untuk kecepatan maksimal
        let mut file = match tokio::fs::File::create(&filepath).await {
            Ok(f) => tokio::io::BufWriter::with_capacity(512 * 1024, f), // 512KB buffer
            Err(_) => continue,
        };

        let mut size: u64 = 0;
        let mut size_exceeded = false;
        let mut buffer = Vec::with_capacity(2 * 1024 * 1024); // 2MB pre-allocated buffer

        while let Some(chunk) = field.next().await {
            if let Ok(data) = chunk {
                size += data.len() as u64;
                if size > MAX_FILE_SIZE {
                    size_exceeded = true;
                    break;
                }
                buffer.extend_from_slice(&data);
                
                // Flush ke disk setiap 4MB untuk balance memory dan I/O
                if buffer.len() >= 4 * 1024 * 1024 {
                    if file.write_all(&buffer).await.is_err() {
                        break;
                    }
                    buffer.clear();
                }
            }
        }

        // Write remaining buffer
        if !buffer.is_empty() && !size_exceeded {
            file.write_all(&buffer).await.ok();
        }
        file.flush().await.ok();

        if size_exceeded {
            tokio::fs::remove_file(&filepath).await.ok();
            return HttpResponse::PayloadTooLarge().json(serde_json::json!({
                "error": "Ukuran file melebihi batas maksimal 300MB",
                "max_size_mb": 300
            }));
        }

        let file_id = Uuid::new_v4().to_string();
        let uploaded_at = Utc::now();
        let path_str = filepath.to_string_lossy().to_string();

        let db = shared.db.lock().await;
        db.execute(
            "INSERT INTO files (id, meja_id, filename, size, uploaded_at, path) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![file_id, meja_id, filename, size as i64, uploaded_at.to_rfc3339(), path_str],
        ).ok();
        drop(db);

        uploaded_files.push(FileInfo {
            id: file_id,
            filename: filename.clone(),
            size,
            uploaded_at,
            path: path_str,
        });
    }

    let mut state = shared.state.write().await;
    if let Some(meja) = state.meja_list.get_mut(&meja_id) {
        meja.files.extend(uploaded_files);
        meja.last_upload = Some(Utc::now());
    }

    drop(state);
    broadcast_state(&shared).await;

    HttpResponse::Ok().json(serde_json::json!({"success": true}))
}

async fn get_meja(
    shared: web::Data<Arc<SharedState>>,
    path: web::Path<String>,
) -> impl Responder {
    let meja_id = path.into_inner();
    let state = shared.state.read().await;

    if let Some(meja) = state.meja_list.get(&meja_id) {
        return HttpResponse::Ok().json(meja);
    }

    HttpResponse::NotFound().json(serde_json::json!({"error": "Meja not found"}))
}

async fn get_soal_list(shared: web::Data<Arc<SharedState>>) -> impl Responder {
    let state = shared.state.read().await;
    HttpResponse::Ok().json(&state.soal_files)
}

async fn download_soal(
    shared: web::Data<Arc<SharedState>>,
    path: web::Path<String>,
) -> impl Responder {
    let soal_id = path.into_inner();
    let state = shared.state.read().await;

    if let Some(soal) = state.soal_files.iter().find(|s| s.id == soal_id) {
        let filepath = PathBuf::from(&soal.path);
        if filepath.exists() {
            if let Ok(file_data) = tokio::fs::read(&filepath).await {
                let mime = mime_guess::from_path(&filepath).first_or_octet_stream();
                return HttpResponse::Ok()
                    .content_type(mime.to_string())
                    .insert_header(("Content-Disposition", format!("attachment; filename=\"{}\"", soal.filename)))
                    .body(file_data);
            }
        }
    }

    HttpResponse::NotFound().json(serde_json::json!({"error": "File not found"}))
}

// === Archive Preview ===

async fn preview_archive(path: web::Path<(String, String)>) -> impl Responder {
    let (meja_id, _file_id) = path.into_inner();
    let upload_path = get_uploads_path(&meja_id);

    let entries: Vec<ArchiveEntry> = vec![];

    if let Ok(mut dir) = tokio::fs::read_dir(&upload_path).await {
        while let Ok(Some(entry)) = dir.next_entry().await {
            let filepath = entry.path();
            let filename = filepath.file_name().unwrap_or_default().to_string_lossy();

            if filename.to_lowercase().ends_with(".zip") {
                if let Ok(file) = std::fs::File::open(&filepath) {
                    if let Ok(mut archive) = zip::ZipArchive::new(file) {
                        let mut entries = vec![];
                        for i in 0..archive.len() {
                            if let Ok(file) = archive.by_index(i) {
                                entries.push(ArchiveEntry {
                                    name: file.name().to_string(),
                                    size: file.size(),
                                    is_dir: file.is_dir(),
                                });
                            }
                        }
                        return HttpResponse::Ok().json(ArchiveContent { files: entries });
                    }
                }
            }
        }
    }

    HttpResponse::Ok().json(ArchiveContent { files: entries })
}

async fn preview_archive_by_path(query: web::Query<HashMap<String, String>>) -> impl Responder {
    let filepath = match query.get("path") {
        Some(p) => PathBuf::from(p),
        None => return HttpResponse::BadRequest().json(serde_json::json!({"error": "Path required"})),
    };

    if !filepath.exists() {
        return HttpResponse::NotFound().json(serde_json::json!({"error": "File not found"}));
    }

    let filename = filepath.file_name().unwrap_or_default().to_string_lossy().to_lowercase();

    if filename.ends_with(".zip") {
        if let Ok(file) = std::fs::File::open(&filepath) {
            if let Ok(mut archive) = zip::ZipArchive::new(file) {
                let mut entries = vec![];
                for i in 0..archive.len() {
                    if let Ok(file) = archive.by_index(i) {
                        entries.push(ArchiveEntry {
                            name: file.name().to_string(),
                            size: file.size(),
                            is_dir: file.is_dir(),
                        });
                    }
                }
                return HttpResponse::Ok().json(ArchiveContent { files: entries });
            }
        }
    }

    HttpResponse::Ok().json(ArchiveContent { files: vec![] })
}

async fn preview_file_content(query: web::Query<HashMap<String, String>>) -> impl Responder {
    let filepath = match query.get("path") {
        Some(p) => PathBuf::from(p),
        None => return HttpResponse::BadRequest().json(serde_json::json!({"error": "Path required"})),
    };

    if !filepath.exists() {
        return HttpResponse::NotFound().json(serde_json::json!({"error": "File not found"}));
    }

    let filename = filepath.file_name().unwrap_or_default().to_string_lossy().to_string();
    let metadata = tokio::fs::metadata(&filepath).await.ok();
    let size = metadata.map(|m| m.len()).unwrap_or(0);

    let text_extensions = ["txt", "html", "css", "js", "ts", "tsx", "jsx", "json", "xml", "md", "py", "rs", "c", "cpp", "h", "java", "php", "sql", "sh", "bat", "yml", "yaml", "toml", "ini", "cfg", "log"];
    let ext = filepath.extension().unwrap_or_default().to_string_lossy().to_lowercase();
    let is_text = text_extensions.contains(&ext.as_str());

    let content = if is_text && size < 1_000_000 {
        tokio::fs::read_to_string(&filepath).await.ok()
    } else {
        None
    };

    HttpResponse::Ok().json(FilePreview {
        filename,
        content,
        is_text,
        size,
    })
}

// === WebSocket for Real-time Updates ===

async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    shared: web::Data<Arc<SharedState>>,
) -> Result<HttpResponse, actix_web::Error> {
    let (res, mut session, mut stream) = actix_ws::handle(&req, stream)?;

    let mut rx = shared.broadcast_tx.subscribe();

    // Kirim state awal ke client baru
    {
        let state = shared.state.read().await;
        if let Ok(json) = serde_json::to_string(&*state) {
            let _ = session.text(json).await;
        }
    }

    // Hanya handle WebSocket messages, TIDAK spawn timer task baru
    actix_web::rt::spawn(async move {
        loop {
            tokio::select! {
                msg = rx.recv() => {
                    match msg {
                        Ok(text) => {
                            if session.text(text).await.is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                msg = stream.next() => {
                    match msg {
                        Some(Ok(Message::Ping(bytes))) => {
                            if session.pong(&bytes).await.is_err() {
                                break;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => break,
                        _ => {}
                    }
                }
            }
        }
    });

    Ok(res)
}

// === Global Timer Task - Hanya berjalan SEKALI ===
async fn start_global_timer_task(shared: Arc<SharedState>) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(TIMER_BROADCAST_INTERVAL_MS));
    let mut last_remaining: i64 = -1;
    
    loop {
        interval.tick().await;
        
        let should_broadcast = {
            let mut state = shared.state.write().await;
            if state.timer.is_running {
                if let Some(started) = state.timer.started_at {
                    let elapsed = Utc::now().signed_duration_since(started).num_seconds();
                    let remaining = (state.timer.duration_seconds - elapsed).max(0);
                    
                    // Hanya update jika nilai berubah
                    if remaining != last_remaining {
                        last_remaining = remaining;
                        state.timer.remaining_seconds = remaining;
                        
                        if remaining <= 0 {
                            state.timer.is_running = false;
                            state.timer.started_at = None;
                        }
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                last_remaining = state.timer.remaining_seconds;
                false
            }
        };
        
        if should_broadcast {
            broadcast_timer_only(&shared).await;
        }
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    println!("===========================================");
    println!("  Lomba Coding Server - OPTIMIZED");
    println!("===========================================");
    println!("Server: http://localhost:3001");
    println!("Default admin: admin / admin123");
    println!("Timer broadcast: {}ms interval", TIMER_BROADCAST_INTERVAL_MS);
    println!("===========================================");

    get_storage_path();
    get_soal_path();

    let db_path = get_storage_path().join("lomba.db");
    let conn = Connection::open(&db_path).expect("Failed to open database");
    init_database(&conn).expect("Failed to initialize database");

    let initial_state = load_state_from_db(&conn);

    // Buffer lebih besar untuk broadcast channel
    let (broadcast_tx, _) = broadcast::channel::<String>(256);

    let shared_state = Arc::new(SharedState {
        state: RwLock::new(initial_state),
        broadcast_tx,
        db: Mutex::new(conn),
    });

    // Start SINGLE global timer task
    let timer_shared = shared_state.clone();
    tokio::spawn(async move {
        start_global_timer_task(timer_shared).await;
    });

    let server_shared = shared_state.clone();

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header();

        let payload_config = web::PayloadConfig::default()
            .limit(300 * 1024 * 1024);

        // Multipart config untuk upload lebih cepat
        let multipart_config = actix_multipart::form::MultipartFormConfig::default()
            .total_limit(300 * 1024 * 1024)
            .memory_limit(50 * 1024 * 1024); // 50MB memory buffer

        App::new()
            .wrap(cors)
            .app_data(payload_config)
            .app_data(multipart_config)
            .app_data(web::Data::new(server_shared.clone()))
            .route("/api/auth/login", web::post().to(admin_login))
            .route("/api/auth/verify", web::get().to(verify_token))
            .route("/api/auth/change-password", web::post().to(change_password))
            .route("/api/state", web::get().to(get_state))
            .route("/api/admin/meja/generate", web::post().to(generate_meja))
            .route("/api/admin/meja/export", web::get().to(export_meja))
            .route("/api/admin/meja/export/json", web::get().to(export_meja_json))
            .route("/api/admin/timer/set", web::post().to(set_timer))
            .route("/api/admin/timer/start", web::post().to(start_timer))
            .route("/api/admin/timer/pause", web::post().to(pause_timer))
            .route("/api/admin/timer/reset", web::post().to(reset_timer))
            .route("/api/admin/timer/adjust", web::post().to(adjust_timer))
            .route("/api/admin/soal/upload", web::post().to(upload_soal))
            .route("/api/admin/soal/{id}", web::delete().to(delete_soal))
            .route("/api/login", web::post().to(login_peserta))
            .route("/api/meja/{id}", web::get().to(get_meja))
            .route("/api/meja/{id}/update", web::post().to(update_peserta))
            .route("/api/meja/{id}/upload", web::post().to(upload_file))
            .route("/api/soal", web::get().to(get_soal_list))
            .route("/api/soal/{id}/download", web::get().to(download_soal))
            .route("/api/archive/preview/{meja_id}/{file_id}", web::get().to(preview_archive))
            .route("/api/archive/preview", web::get().to(preview_archive_by_path))
            .route("/api/file/preview", web::get().to(preview_file_content))
            .route("/ws", web::get().to(ws_handler))
            .service(Files::new("/storage", "./storage"))
    })
    .workers(4) // Optimal untuk konkurensi
    .bind("0.0.0.0:3001")?
    .run()
    .await
}
