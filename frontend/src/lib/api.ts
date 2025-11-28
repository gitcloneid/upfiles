const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export type UploadProgressCallback = (progress: number) => void;

function getAuthHeader(): HeadersInit {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('adminToken');
    if (token) {
      return { 'Authorization': `Bearer ${token}` };
    }
  }
  return {};
}

export const api = {
  // Auth
  async adminLogin(username: string, password: string) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return res.json();
  },

  async verifyToken() {
    const res = await fetch(`${API_BASE}/api/auth/verify`, {
      headers: getAuthHeader(),
    });
    return res.json();
  },

  async changePassword(oldPassword: string, newPassword: string) {
    const res = await fetch(`${API_BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    });
    return res.json();
  },

  // Admin
  async getState() {
    const res = await fetch(`${API_BASE}/api/state`);
    return res.json();
  },

  async generateMeja(jumlah: number) {
    const res = await fetch(`${API_BASE}/api/admin/meja/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ jumlah }),
    });
    return res.json();
  },

  async exportMejaCsv() {
    const res = await fetch(`${API_BASE}/api/admin/meja/export`, {
      headers: getAuthHeader(),
    });
    return res;
  },

  async exportMejaJson() {
    const res = await fetch(`${API_BASE}/api/admin/meja/export/json`, {
      headers: getAuthHeader(),
    });
    return res.json();
  },

  async setTimer(durationMinutes: number) {
    const res = await fetch(`${API_BASE}/api/admin/timer/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ duration_minutes: durationMinutes }),
    });
    return res.json();
  },

  async startTimer() {
    const res = await fetch(`${API_BASE}/api/admin/timer/start`, { 
      method: 'POST',
      headers: getAuthHeader(),
    });
    return res.json();
  },

  async pauseTimer() {
    const res = await fetch(`${API_BASE}/api/admin/timer/pause`, { 
      method: 'POST',
      headers: getAuthHeader(),
    });
    return res.json();
  },

  async resetTimer() {
    const res = await fetch(`${API_BASE}/api/admin/timer/reset`, { 
      method: 'POST',
      headers: getAuthHeader(),
    });
    return res.json();
  },

  async adjustTimer(seconds: number) {
    const res = await fetch(`${API_BASE}/api/admin/timer/adjust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ seconds }),
    });
    return res.json();
  },

  uploadSoalWithProgress(files: FileList, onProgress?: UploadProgressCallback): Promise<{ success: boolean }> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('adminToken') : null;
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
      
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/admin/soal/upload`);
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress);
        }
      };
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error('Upload failed'));
        }
      };
      
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    });
  },

  async deleteSoal(id: string) {
    const res = await fetch(`${API_BASE}/api/admin/soal/${id}`, { 
      method: 'DELETE',
      headers: getAuthHeader(),
    });
    return res.json();
  },

  // Participant
  async login(kode: string) {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kode }),
    });
    return res.json();
  },

  async getMeja(id: string) {
    const res = await fetch(`${API_BASE}/api/meja/${id}`);
    return res.json();
  },

  async updatePeserta(mejaId: string, nama: string) {
    const res = await fetch(`${API_BASE}/api/meja/${mejaId}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nama }),
    });
    return res.json();
  },

  uploadFileWithProgress(mejaId: string, files: FileList, onProgress?: UploadProgressCallback): Promise<{ success: boolean }> {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
      
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/meja/${mejaId}/upload`);
      
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress);
        }
      };
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          try {
            const errorResponse = JSON.parse(xhr.responseText);
            reject(new Error(errorResponse.error || 'Upload failed'));
          } catch {
            reject(new Error('Upload failed'));
          }
        }
      };
      
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    });
  },

  async getSoalList() {
    const res = await fetch(`${API_BASE}/api/soal`);
    return res.json();
  },

  getSoalDownloadUrl(id: string) {
    return `${API_BASE}/api/soal/${id}/download`;
  },

  getFileDownloadUrl(path: string) {
    return `${API_BASE}/storage/${path.replace(/\\/g, '/').replace('./storage/', '')}`;
  },

  async previewArchive(path: string) {
    const res = await fetch(`${API_BASE}/api/archive/preview?path=${encodeURIComponent(path)}`);
    return res.json();
  },

  async previewFile(path: string) {
    const res = await fetch(`${API_BASE}/api/file/preview?path=${encodeURIComponent(path)}`);
    return res.json();
  },

  getWsUrl() {
    const wsBase = API_BASE.replace('http', 'ws');
    return `${wsBase}/ws`;
  },
};
