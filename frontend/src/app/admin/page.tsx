"use client";

import { useState, useRef, useEffect } from "react";
import { useWebSocket } from "@/lib/useWebSocket";
import { api } from "@/lib/api";
import type { FileInfo } from "@/lib/types";
import { Timer } from "@/components/Timer";
import { ArchiveViewer, FileViewer } from "@/components/ArchiveViewer";
import { AdminLogin } from "@/components/AdminLogin";
import { useTimerAlert } from "@/components/TimerAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";

export default function AdminPage() {
  const { state, connected } = useWebSocket();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [jumlahMeja, setJumlahMeja] = useState(10);
  const [timerMinutes, setTimerMinutes] = useState(60);
  const soalInputRef = useRef<HTMLInputElement>(null);

  const [archiveView, setArchiveView] = useState<{
    path: string;
    filename: string;
  } | null>(null);
  const [fileView, setFileView] = useState<{
    path: string;
    filename: string;
  } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Timer alert hook (always enabled)
  useTimerAlert(
    state?.timer ?? {
      is_running: false,
      duration_seconds: 0,
      remaining_seconds: 0,
      started_at: null,
    },
    true
  );

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem("adminToken");
      if (!token) {
        setIsAuthenticated(false);
        return;
      }
      try {
        const res = await api.verifyToken();
        setIsAuthenticated(res.valid === true);
      } catch {
        setIsAuthenticated(false);
      }
    };
    checkAuth();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("adminToken");
    setIsAuthenticated(false);
  };

  const handleExportCsv = async () => {
    try {
      const res = await api.exportMejaCsv();
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "daftar_meja.csv";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      console.error("Export failed:", e);
    }
  };

  // Show login if not authenticated
  if (isAuthenticated === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AdminLogin onLogin={() => setIsAuthenticated(true)} />;
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p>Menghubungkan ke server...</p>
        </div>
      </div>
    );
  }

  const mejaList = Object.values(state.meja_list).sort(
    (a, b) => a.nomor - b.nomor
  );
  const mejaWithFiles = mejaList.filter((m) => m.files.length > 0);
  const totalFiles = mejaList.reduce((sum, m) => sum + m.files.length, 0);

  const handleGenerateMeja = async () => {
    await api.generateMeja(jumlahMeja);
  };

  const handleSetTimer = async () => {
    await api.setTimer(timerMinutes);
  };

  const handleUploadSoal = async () => {
    const files = soalInputRef.current?.files;
    if (files && files.length > 0) {
      setUploadProgress(0);
      try {
        await api.uploadSoalWithProgress(files, (progress) => {
          setUploadProgress(progress);
        });
      } finally {
        setTimeout(() => setUploadProgress(null), 1000);
        if (soalInputRef.current) soalInputRef.current.value = "";
      }
    }
  };

  const handleDeleteSoal = async (id: string) => {
    await api.deleteSoal(id);
  };

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

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Admin Panel</h1>
        <div className="flex items-center gap-4">
          <Badge variant={connected ? "default" : "destructive"}>
            {connected ? "Connected" : "Disconnected"}
          </Badge>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-6">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="meja">Daftar Meja</TabsTrigger>
          <TabsTrigger value="soal">Soal</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Timer Card */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Timer Lomba</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center py-4">
                  <Timer timer={state.timer} large />
                  <div className="flex justify-center gap-2 mt-4">
                    <Button
                      onClick={() => api.startTimer()}
                      disabled={state.timer.is_running}
                    >
                      Start
                    </Button>
                    <Button
                      onClick={() => api.pauseTimer()}
                      variant="secondary"
                      disabled={!state.timer.is_running}
                    >
                      Pause
                    </Button>
                    <Button onClick={() => api.resetTimer()} variant="outline">
                      Reset
                    </Button>
                  </div>
                </div>
                <Separator />
                <div>
                  <Label className="text-muted-foreground text-sm">
                    Tambah/Kurangi Waktu (Realtime)
                  </Label>
                  <div className="flex justify-center gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => api.adjustTimer(-60)}
                    >
                      -1m
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => api.adjustTimer(-300)}
                    >
                      -5m
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => api.adjustTimer(-600)}
                    >
                      -10m
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => api.adjustTimer(60)}
                    >
                      +1m
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => api.adjustTimer(300)}
                    >
                      +5m
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => api.adjustTimer(600)}
                    >
                      +10m
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => api.adjustTimer(1800)}
                    >
                      +30m
                    </Button>
                  </div>
                </div>
                <Separator />
                <div className="flex items-end gap-4">
                  <div className="flex-1">
                    <Label>Set Durasi Baru (menit)</Label>
                    <Input
                      type="number"
                      value={timerMinutes}
                      onChange={(e) =>
                        setTimerMinutes(parseInt(e.target.value) || 0)
                      }
                      min={1}
                    />
                  </div>
                  <Button onClick={handleSetTimer}>Set Timer</Button>
                </div>
              </CardContent>
            </Card>

            {/* Stats Card */}
            <Card>
              <CardHeader>
                <CardTitle>Statistik</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center">
                  <div className="text-4xl font-bold">{mejaList.length}</div>
                  <div className="text-muted-foreground">Total Meja</div>
                </div>
                <Separator />
                <div className="text-center">
                  <div className="text-4xl font-bold text-green-600">
                    {mejaWithFiles.length}
                  </div>
                  <div className="text-muted-foreground">Sudah Upload</div>
                </div>
                <Separator />
                <div className="text-center">
                  <div className="text-4xl font-bold text-blue-600">
                    {totalFiles}
                  </div>
                  <div className="text-muted-foreground">Total File</div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Generate Meja */}
          <Card>
            <CardHeader>
              <CardTitle>Generate Meja</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <Label>Jumlah Meja</Label>
                  <Input
                    type="number"
                    value={jumlahMeja}
                    onChange={(e) =>
                      setJumlahMeja(parseInt(e.target.value) || 0)
                    }
                    min={1}
                    max={100}
                  />
                </div>
                <Button onClick={handleGenerateMeja}>Generate</Button>
                {mejaList.length > 0 && (
                  <Button variant="outline" onClick={handleExportCsv}>
                    Export CSV
                  </Button>
                )}
              </div>
              {mejaList.length > 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  Catatan: Generate akan menghapus semua meja yang ada
                </p>
              )}
            </CardContent>
          </Card>

          {/* Recent Uploads */}
          {mejaWithFiles.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Upload Terbaru</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[300px]">
                  <div className="space-y-3">
                    {mejaWithFiles
                      .sort((a, b) => {
                        const timeA = a.last_upload
                          ? new Date(a.last_upload).getTime()
                          : 0;
                        const timeB = b.last_upload
                          ? new Date(b.last_upload).getTime()
                          : 0;
                        return timeB - timeA;
                      })
                      .slice(0, 10)
                      .map((meja) => (
                        <div
                          key={meja.id}
                          className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                        >
                          <div>
                            <div className="font-medium">Meja {meja.nomor}</div>
                            <div className="text-sm text-muted-foreground">
                              {meja.nama_peserta || "Belum ada nama"}
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge variant="secondary">
                              {meja.files.length} file
                            </Badge>
                            {meja.last_upload && (
                              <div className="text-xs text-muted-foreground mt-1">
                                {new Date(
                                  meja.last_upload
                                ).toLocaleTimeString()}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="meja">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Daftar Meja ({mejaList.length})</CardTitle>
              {mejaList.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleExportCsv}>
                  Export CSV
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {mejaList.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  Belum ada meja. Generate meja terlebih dahulu.
                </p>
              ) : (
                <ScrollArea className="h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Meja</TableHead>
                        <TableHead>Kode</TableHead>
                        <TableHead>Peserta</TableHead>
                        <TableHead>Files</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mejaList.map((meja) => (
                        <TableRow key={meja.id}>
                          <TableCell className="font-medium">
                            Meja {meja.nomor}
                          </TableCell>
                          <TableCell>
                            <code className="bg-muted px-2 py-1 rounded">
                              {meja.kode}
                            </code>
                          </TableCell>
                          <TableCell>{meja.nama_peserta || "-"}</TableCell>
                          <TableCell>
                            {meja.files.length > 0 ? (
                              <div className="space-y-2">
                                {[...meja.files]
                                  .sort(
                                    (a, b) =>
                                      new Date(b.uploaded_at).getTime() -
                                      new Date(a.uploaded_at).getTime()
                                  )
                                  .map((file) => (
                                    <div
                                      key={file.id}
                                      className="flex flex-col gap-1 p-2 bg-muted/30 rounded text-sm"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium truncate max-w-[200px]">
                                          {file.filename}
                                        </span>
                                        <div className="flex items-center gap-1">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-2 text-xs"
                                            onClick={() =>
                                              openFilePreview(file)
                                            }
                                          >
                                            Preview
                                          </Button>
                                          <a
                                            href={api.getFileDownloadUrl(
                                              file.path
                                            )}
                                            download={file.filename}
                                          >
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="h-6 px-2 text-xs"
                                            >
                                              Download
                                            </Button>
                                          </a>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>{formatSize(file.size)}</span>
                                        <span>•</span>
                                        <span>
                                          {new Date(
                                            file.uploaded_at
                                          ).toLocaleString("id-ID")}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                              </div>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            {meja.files.length > 0 ? (
                              <Badge variant="default">Sudah Upload</Badge>
                            ) : (
                              <Badge variant="outline">Belum Upload</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="soal">
          <Card>
            <CardHeader>
              <CardTitle>File Soal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <Label>Upload File Soal</Label>
                  <Input
                    type="file"
                    ref={soalInputRef}
                    multiple
                    disabled={uploadProgress !== null}
                  />
                </div>
                <Button
                  onClick={handleUploadSoal}
                  disabled={uploadProgress !== null}
                >
                  {uploadProgress !== null ? "Uploading..." : "Upload"}
                </Button>
              </div>
              {uploadProgress !== null && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Mengupload...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} className="h-2" />
                </div>
              )}
              <Separator />
              {state.soal_files.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">
                  Belum ada file soal yang diupload.
                </p>
              ) : (
                <div className="space-y-2">
                  {state.soal_files.map((soal) => (
                    <div
                      key={soal.id}
                      className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                    >
                      <div>
                        <div className="font-medium">{soal.filename}</div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(soal.uploaded_at).toLocaleString()}
                        </div>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteSoal(soal.id)}
                      >
                        Hapus
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
