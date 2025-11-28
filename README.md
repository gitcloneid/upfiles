# Lomba Coding - File Upload Management System

Sistem manajemen lomba coding lokal dengan fitur:
- Generate meja dengan kode unik
- Timer lomba realtime (WebSocket)
- Upload/download soal
- Preview isi ZIP/RAR tanpa download
- Multi-file upload dari peserta

## Menjalankan Aplikasi

### 1. Backend (Rust)

```bash
cd backend
cargo run
```

Server akan berjalan di `http://localhost:3001`

### 2. Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Aplikasi akan berjalan di `http://localhost:3000`

## Akses

- **Homepage**: http://localhost:3000
- **Admin Panel**: http://localhost:3000/admin
- **Peserta**: http://localhost:3000/peserta

## Struktur File Storage

Semua file disimpan di folder `backend/storage/`:
- `storage/soal/` - File soal dari admin
- `storage/uploads/{meja_id}/` - File upload dari peserta
