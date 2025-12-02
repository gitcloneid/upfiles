"use client";

import { useState, useRef, useEffect } from "react";
import { useWebSocket } from "@/lib/useWebSocket";
import { api } from "@/lib/api";
import type { Meja, SoalFile, FileInfo } from "@/lib/types";
import { Timer } from "@/components/Timer";
import { ArchiveViewer, FileViewer } from "@/components/ArchiveViewer";
import { useTimerAlert } from "@/components/TimerAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";

export default function PesertaPage() {
  const { state, connected } = useWebSocket();
  const [kode, setKode] = useState("");
  const [meja, setMeja] = useState<Meja | null>(null);
  const [nama, setNama] = useState("");
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [hasFiles, setHasFiles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Timer alert hook (always enabled when logged in)
  useTimerAlert(
    state?.timer ?? {
      is_running: false,
      duration_seconds: 0,
      remaining_seconds: 0,
      started_at: null,
    },
    meja !== null
  );

  const [archiveView, setArchiveView] = useState<{
    path: string;
    filename: string;
  } | null>(null);
  const [fileView, setFileView] = useState<{
    path: string;
    filename: string;
  } | null>(null);

  // Load saved session
  useEffect(() => {
    const savedMejaId = localStorage.getItem("mejaId");
    const savedKode = localStorage.getItem("mejaKode");
    if (savedMejaId && savedKode) {
      setKode(savedKode);
      api.login(savedKode).then((res) => {
        if (res.success) {
          setMeja(res.meja);
          setNama(res.meja.nama_peserta || "");
        }
      });
    }
  }, []);

  // Update meja from websocket state
  useEffect(() => {
    if (state && meja) {
      const updatedMeja = state.meja_list[meja.id];
      if (updatedMeja) {
        setMeja(updatedMeja);
      }
    }
  }, [state, meja?.id]);

  const handleLogin = async () => {
    setError("");
    const res = await api.login(kode);
    if (res.success) {
      setMeja(res.meja);
      setNama(res.meja.nama_peserta || "");
      localStorage.setItem("mejaId", res.meja.id);
      localStorage.setItem("mejaKode", kode);
    } else {
      setError(res.error || "Kode tidak valid");
    }
  };

  const handleLogout = () => {
    setMeja(null);
    setKode("");
    setNama("");
    localStorage.removeItem("mejaId");
    localStorage.removeItem("mejaKode");
  };

  const handleUpdateNama = async () => {
    if (meja && nama) {
      await api.updatePeserta(meja.id, nama);
    }
  };

  const MAX_FILE_SIZE = 300 * 1024 * 1024; // 300MB

  const handleUpload = async () => {
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0 || !meja) return;

    // Check file sizes before upload
    for (let i = 0; i < files.length; i++) {
      if (files[i].size > MAX_FILE_SIZE) {
        setError(`File "${files[i].name}" melebihi batas maksimal 300MB`);
        return;
      }
    }

    setUploadProgress(0);
    setError("");
    try {
      await api.uploadFileWithProgress(meja.id, files, (progress) => {
        setUploadProgress(progress);
      });
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Upload gagal";
      if (
        errorMessage.includes("time_expired") ||
        errorMessage.includes("Waktu")
      ) {
        setError("Waktu lomba telah habis. Upload tidak diperbolehkan.");
      } else {
        setError(errorMessage);
      }
    } finally {
      setTimeout(() => setUploadProgress(null), 1000);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setHasFiles(false);
    }
  };

  // Check if time is expired
  const isTimeExpired =
    state?.timer &&
    state.timer.remaining_seconds <= 0 &&
    state.timer.duration_seconds > 0;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isArchive = (filename: string) => {
    const ext = filename.toLowerCase();
    return ext.endsWith(".zip") || ext.endsWith(".rar");
  };

  const openFilePreview = (file: FileInfo) => {
    if (isArchive(file.filename)) {
      setArchiveView({ path: file.path, filename: file.filename });
    } else {
      setFileView({ path: file.path, filename: file.filename });
    }
  };

  // Login Page
  if (!meja) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-background to-muted/50">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Peserta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label>Kode Meja</Label>
              <Input
                value={kode}
                onChange={(e) => setKode(e.target.value.toLowerCase())}
                placeholder="Masukkan kode 6 karakter"
                maxLength={6}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              />
            </div>
            <Button
              className="w-full"
              onClick={handleLogin}
              disabled={kode.length !== 6}
            >
              Masuk
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main Page
  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Peserta</h1>
        </div>
        <div className="flex items-center gap-4">
          <Badge variant={connected ? "default" : "destructive"}>
            {connected ? "Online" : "Offline"}
          </Badge>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Keluar
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {/* Timer */}
        {state && (
          <Card>
            <CardHeader className="text-center pb-2">
              <CardTitle>Waktu Tersisa</CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <Timer timer={state.timer} large />
              {state.timer.remaining_seconds === 0 && (
                <p className="text-red-600 mt-2 font-medium">Waktu Habis!</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Meja Info */}
        <Card>
          <CardHeader>
            <CardTitle>Informasi Meja</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Nomor Meja</Label>
                <div className="text-2xl font-bold">Meja {meja.nomor}</div>
              </div>
              <div>
                <Label className="text-muted-foreground">Kode</Label>
                <div className="text-2xl font-mono">{meja.kode}</div>
              </div>
            </div>
            <Separator />
            <div>
              <Label>Nama Peserta</Label>
              <Input
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                onBlur={handleUpdateNama}
                placeholder="Masukkan nama anda"
              />
            </div>
          </CardContent>
        </Card>

        {/* Download Soal */}
        {state && state.soal_files.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Download Soal</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {state.soal_files.map((soal: SoalFile) => (
                  <div
                    key={soal.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                  >
                    <span className="font-medium">{soal.filename}</span>
                    <a href={api.getSoalDownloadUrl(soal.id)} download>
                      <Button size="sm">Download</Button>
                    </a>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upload */}
        <Card>
          <CardHeader>
            <CardTitle>Upload Hasil Kerja</CardTitle>
            <CardDescription>
              Upload file hasil kerja anda (ZIP).
               Maksimal 300MB per file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isTimeExpired && (
              <Alert variant="destructive">
                <AlertDescription>
                  Waktu habis!!
                </AlertDescription>
              </Alert>
            )}

            {error && !isTimeExpired && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-3">
              <div>
                <Label>Pilih File</Label>
                <Input
                  type="file"
                  ref={fileInputRef}
                  multiple
                  accept=".zip,.rar,*"
                  disabled={uploadProgress !== null || isTimeExpired}
                  onChange={(e) => setHasFiles((e.target.files?.length ?? 0) > 0)}
                />
              </div>
              <Button
                onClick={handleUpload}
                disabled={uploadProgress !== null || isTimeExpired || !hasFiles}
                className="w-full"
              >
                {uploadProgress !== null ? "Uploading..." : "Upload"}
              </Button>
            </div>

            {uploadProgress !== null && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Mengupload file...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-3" />
              </div>
            )}

            {meja.files.length > 0 && (
              <>
                <Separator />
                <div>
                  <Label className="text-muted-foreground">
                    File yang sudah diupload:
                  </Label>
                  <div className="space-y-2 mt-2">
                    {meja.files.map((file) => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                      >
                        <div>
                          <div className="font-medium">{file.filename}</div>
                          <div className="text-sm text-muted-foreground">
                            {formatSize(file.size)} -{" "}
                            {new Date(file.uploaded_at).toLocaleString()}
                          </div>
                        </div>
                        {isArchive(file.filename) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openFilePreview(file)}
                          >
                            Lihat Isi
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {archiveView && (
        <ArchiveViewer
          path={archiveView.path}
          filename={archiveView.filename}
          open={!!archiveView}
          onClose={() => setArchiveView(null)}
        />
      )}

      {fileView && (
        <FileViewer
          path={fileView.path}
          filename={fileView.filename}
          open={!!fileView}
          onClose={() => setFileView(null)}
        />
      )}
    </div>
  );
}
