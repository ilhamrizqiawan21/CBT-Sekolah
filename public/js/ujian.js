const ujianId = window.ujianId;
const siswaId = window.siswaId;
let waktuTersisa       = 0;
let timerInterval      = null;
let heartbeatInterval  = null;
let resyncTimerInterval = null;
let totalSoal          = 0;
let terjawab           = 0;
let pollingInterval    = null;
let ujianSudahSelesai  = false;

// ─────────────────────────────────────────────
// Storage Keys (DESIGN §3.3, T1.7)
// Jawaban disimpan di localStorage per siswa+ujian
// Antrean sinkronisasi disimpan di localStorage
// ─────────────────────────────────────────────
const KEY_LOCAL_ANSWERS = `answers_${siswaId}_${ujianId}`;
const KEY_QUEUE         = `sync_queue_${siswaId}_${ujianId}`;

const socket = io();

function getLocalAnswers() {
    try { return JSON.parse(localStorage.getItem(KEY_LOCAL_ANSWERS) || '{}'); }
    catch { return {}; }
}
function saveLocalAnswers(ans) {
    try { localStorage.setItem(KEY_LOCAL_ANSWERS, JSON.stringify(ans)); } catch {}
}

function getSyncQueue() {
    try { return JSON.parse(localStorage.getItem(KEY_QUEUE) || '[]'); }
    catch { return []; }
}
function saveSyncQueue(q) {
    try { localStorage.setItem(KEY_QUEUE, JSON.stringify(q)); } catch {}
}

function isAnswered(soal_id) {
    const local = getLocalAnswers();
    return local[soal_id] !== undefined && local[soal_id] !== null && String(local[soal_id]).trim() !== '';
}

// ── Indikator Sinkronisasi (T1.7) ──
function updateSyncIndicator(status, message = null) {
    const el = document.getElementById('sync-indicator');
    const txt = document.getElementById('sync-indicator-txt');
    const icon = document.getElementById('sync-icon');
    if (!el || !txt) return;

    el.classList.remove('sync-saved', 'sync-saving', 'sync-offline');
    if (status === 'saving') {
        el.classList.add('sync-saving');
        txt.textContent = message || 'Menyimpan...';
        if (icon) icon.className = 'bi bi-cloud-arrow-up-fill';
    } else if (status === 'offline') {
        el.classList.add('sync-offline');
        txt.textContent = message || 'Menunggu sinyal';
        if (icon) icon.className = 'bi bi-cloud-slash-fill';
    } else {
        el.classList.add('sync-saved');
        txt.textContent = message || 'Tersimpan';
        if (icon) icon.className = 'bi bi-cloud-check-fill';
    }
}

// ── Penanganan Pengambilalihan Perangkat (Take-over 409) ──
function handleTakeover() {
    if (ujianSudahSelesai) return;
    ujianSudahSelesai = true;
    if (timerInterval) clearInterval(timerInterval);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (resyncTimerInterval) clearInterval(resyncTimerInterval);
    stopPolling();
    alert('⚠️ Sesi ujian Anda telah diambil alih di perangkat/tab lain.\nHalaman ini akan dialihkan ke halaman login.');
    window.location.href = '/login';
}

// ── Progress bar ──
function updateProgress() {
    if (totalSoal > 0) {
        const bar = document.getElementById('progressBar');
        if (bar) bar.style.width = (terjawab / totalSoal * 100) + '%';
    }
}
function hitungTerjawab() {
    const local = getLocalAnswers();
    terjawab = Object.keys(local).filter(k => isAnswered(k)).length;
    updateProgress();
    updateNavGrid();
}

// ── Navigator soal ──
function updateNavGrid() {
    const grid = document.getElementById('navGrid');
    if (!grid) return;
    grid.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('answered', isAnswered(btn.dataset.soalId));
    });
}
function buildNavGrid(soalList) {
    const grid = document.getElementById('navGrid');
    if (!grid) return;
    grid.innerHTML = '';
    soalList.forEach((soal, idx) => {
        const btn = document.createElement('button');
        btn.className    = 'nav-btn' + (isAnswered(soal.id) ? ' answered' : '');
        btn.textContent  = idx + 1;
        btn.dataset.soalId = soal.id;
        btn.addEventListener('click', () => {
            document.querySelector(`.soal-card[data-id="${soal.id}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        grid.appendChild(btn);
    });
}

// ── Antrean Sinkron Jawaban Batch dengan Exponential Backoff (T1.6, T1.7) ──
let isSyncing = false;
let backoffDelay = 2000;
let retryTimeout = null;

async function simpanJawaban(soal_id, jawaban) {
    const sid = parseInt(soal_id, 10);

    // 1. Simpan segera ke localStorage lokal
    const local = getLocalAnswers();
    local[sid] = jawaban;
    saveLocalAnswers(local);

    // 2. Perbarui progres antarmuka
    hitungTerjawab();

    // 3. Masukkan ke antrean sinkronisasi
    const queue = getSyncQueue();
    const existingIdx = queue.findIndex(q => q.soal_id === sid);
    const item = {
        soal_id: sid,
        jawaban: jawaban,
        client_ts: new Date().toISOString()
    };
    if (existingIdx >= 0) {
        queue[existingIdx] = item;
    } else {
        queue.push(item);
    }
    saveSyncQueue(queue);

    // 4. Picu sinkronisasi
    await kirimAntrian();
}

async function kirimAntrian() {
    if (isSyncing) return;
    const queue = getSyncQueue();
    if (!queue.length) {
        updateSyncIndicator('saved');
        return;
    }

    if (!navigator.onLine) {
        updateSyncIndicator('offline', 'Offline');
        return;
    }

    isSyncing = true;
    updateSyncIndicator('saving');

    // Kirim batch hingga 100 item (batas ukuran batch)
    const batch = queue.slice(0, 100);

    try {
        const res = await fetch('/api/sinkron-jawaban', {
            method:      'POST',
            headers:     { 'Content-Type': 'application/json' },
            body:        JSON.stringify({ jawaban: batch }),
            credentials: 'same-origin'
        });

        if (res.status === 409) {
            isSyncing = false;
            handleTakeover();
            return;
        }

        if (res.status === 401) {
            window.location.href = '/login';
            return;
        }

        if (res.ok) {
            // Berhasil: hapus item yang terkirim dari antrean
            const currentQueue = getSyncQueue();
            const remaining = currentQueue.slice(batch.length);
            saveSyncQueue(remaining);

            backoffDelay = 2000; // Reset delay jika sukses
            isSyncing = false;

            if (remaining.length > 0) {
                // Masih ada sisa antrean, lanjutkan segera
                kirimAntrian();
            } else {
                updateSyncIndicator('saved');
            }
        } else {
            throw new Error(`HTTP ${res.status}`);
        }
    } catch (err) {
        isSyncing = false;
        updateSyncIndicator('offline', 'Menunggu sinyal');

        // Backoff eksponensial untuk retry
        if (retryTimeout) clearTimeout(retryTimeout);
        retryTimeout = setTimeout(() => {
            kirimAntrian();
        }, backoffDelay);
        backoffDelay = Math.min(backoffDelay * 2, 30000);
    }
}

// ── Heartbeat 20 Detik (T1.7, DESIGN §3.3) ──
function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(async () => {
        if (!navigator.onLine || ujianSudahSelesai) return;
        try {
            const res = await fetch('/api/heartbeat', {
                method:      'POST',
                credentials: 'same-origin'
            });
            if (res.status === 409) {
                handleTakeover();
            }
        } catch (_) {}
    }, 20000);
}

// ── Resinkron Timer Tiap 30 Detik (T1.7) ──
async function resinkronTimer() {
    if (!navigator.onLine || ujianSudahSelesai) return;
    try {
        const res = await fetch('/api/sesi', { credentials: 'same-origin' });
        if (res.status === 409) {
            handleTakeover();
            return;
        }
        if (res.ok) {
            const data = await res.json();
            if (data.sisa_detik !== undefined) {
                waktuTersisa = parseInt(data.sisa_detik, 10);
            }
        }
    } catch (_) {}
}

function startResyncTimer() {
    if (resyncTimerInterval) clearInterval(resyncTimerInterval);
    resyncTimerInterval = setInterval(resinkronTimer, 30000);
}

// ── Event Jaringan Klien ──
window.addEventListener('online', () => {
    updateSyncIndicator('saving', 'Tersambung, menyinkron...');
    backoffDelay = 2000;
    kirimAntrian();
    resinkronTimer();
});
window.addEventListener('offline', () => {
    updateSyncIndicator('offline', 'Koneksi terputus');
});

// ── Polling Status Ujian Fallback Server-Side ──
async function cekStatusUjianDariServer() {
    try {
        const res = await fetch('/api/cek-status-ujian', { credentials: 'same-origin' });
        if (res.status === 401) { window.location.href = '/login'; return; }
        if (res.status === 409) { handleTakeover(); return; }
        const data = await res.json();
        if (!data.valid) {
            stopPolling();
            if (data.reason === 'keluar_paksa') {
                showWarning('⚠️ Akses ujian Anda dicabut karena pelanggaran. Ujian akan dikumpulkan.');
                setTimeout(() => selesaiUjian(), 1500);
            } else if (data.reason === 'waktu_habis') {
                showWarning('⚠️ Waktu ujian telah habis. Jawaban dikumpulkan otomatis.');
                setTimeout(() => selesaiUjian(), 1500);
            } else {
                window.location.href = '/login';
            }
        }
    } catch { /* offline / retry */ }
}
function startPolling() {
    if (pollingInterval) return;
    setTimeout(() => {
        cekStatusUjianDariServer();
        pollingInterval = setInterval(cekStatusUjianDariServer, 15000);
    }, 5000);
}
function stopPolling() {
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
}

// ── Unduh Paket Soal (DESIGN §3.3) ──
async function loadSoal() {
    try {
        // 1. Ambil data sesi terlebih dahulu untuk memuat sisa waktu & jawaban tersimpan di server
        try {
            const sesiRes = await fetch('/api/sesi', { credentials: 'same-origin' });
            if (sesiRes.status === 409) {
                handleTakeover();
                return;
            }
            if (sesiRes.ok) {
                const sesiData = await sesiRes.json();
                if (sesiData.jawaban_tersimpan) {
                    const local = getLocalAnswers();
                    for (const [sid, val] of Object.entries(sesiData.jawaban_tersimpan)) {
                        if (local[sid] === undefined) {
                            local[sid] = val;
                        }
                    }
                    saveLocalAnswers(local);
                }
                if (sesiData.sisa_detik !== undefined) {
                    waktuTersisa = parseInt(sesiData.sisa_detik, 10);
                }
            }
        } catch (_) {}

        // 2. Unduh paket butir soal
        const res = await fetch(`/api/soal/${ujianId}`, { credentials: 'same-origin' });
        if (res.status === 409) {
            handleTakeover();
            return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const soal = await res.json();
        if (soal.error) throw new Error(soal.error);

        totalSoal = soal.length;
        hitungTerjawab();
        buildNavGrid(soal);
        renderSoal(soal);

        // Jika ada antrean yang belum terkirim, kirim sekarang
        kirimAntrian();

    } catch (err) {
        console.error('loadSoal error:', err);
        const c = document.getElementById('soal-container');
        if (c) c.innerHTML = `
            <div class="alert alert-danger text-center">
                <i class="bi bi-exclamation-triangle-fill"></i>
                Gagal memuat soal: ${err.message}<br>
                <button class="btn btn-primary mt-3" onclick="location.reload()">Coba Lagi</button>
            </div>`;
    }
}

function renderSoal(soalList) {
    const container = document.getElementById('soal-container');
    if (!container) return;
    container.innerHTML = '';
    const local = getLocalAnswers();

    soalList.forEach((soal, idx) => {
        const div = document.createElement('div');
        div.className = 'soal-card';
        div.setAttribute('data-id', soal.id);

        let html = `
            <div class="soal-header">
                <span class="soal-number">Soal ${idx + 1}</span>
                <span class="soal-poin"><i class="bi bi-star-fill"></i> ${soal.poin} poin</span>
            </div>
            <div class="soal-text">${soal.teks_soal}</div>
        `;

        const savedValue = local[soal.id];

        if (soal.tipe === 'pg') {
            html += `<div class="pilihan-ganda">`;
            soal.pilihan.forEach(p => {
                const isChecked = savedValue === p.key ? 'checked' : '';
                html += `
                    <div class="form-check" onclick="this.querySelector('input').click()">
                        <input class="form-check-input" type="radio"
                               name="soal_${soal.id}" value="${p.key}"
                               id="q_${soal.id}_${p.key}" ${isChecked}>
                        <label class="form-check-label" for="q_${soal.id}_${p.key}">
                            ${p.key}. ${p.text}
                        </label>
                    </div>`;
            });
            html += `</div>`;
        }
        else if (soal.tipe === 'menjodohkan') {
            html += `<div class="menjodohkan mb-3">
                <label class="form-label fw-bold">
                    <i class="bi bi-arrow-left-right"></i> Pasangkan pernyataan berikut:
                </label>
                <select class="form-select" name="soal_${soal.id}" id="select_${soal.id}">
                    <option value="">-- Pilih Jawaban --</option>`;
            (soal.pasangan || []).forEach(p => {
                const isSelected = savedValue === p.kanan ? 'selected' : '';
                html += `<option value="${p.kanan}" ${isSelected}>${p.kiri} → ${p.kanan}</option>`;
            });
            (soal.pengecoh || []).forEach(p => {
                const isSelected = savedValue === p ? 'selected' : '';
                html += `<option value="${p}" ${isSelected}>${p}</option>`;
            });
            html += `</select></div>`;
        }
        else if (soal.tipe === 'essay') {
            // FR-09, D-006: Essay dijawab di kertas
            html += `<div class="essay mb-3">
                <div class="alert alert-light border d-flex align-items-center gap-2 mb-0">
                    <i class="bi bi-journal-text text-primary fs-5"></i>
                    <div>
                        <strong class="d-block text-dark">Dijawab di Lembar Kertas</strong>
                        <small class="text-muted">Tulis jawaban uraian Anda secara rapi pada lembar jawaban kertas yang disediakan pengawas.</small>
                    </div>
                </div>
            </div>`;
        }

        div.innerHTML = html;
        container.appendChild(div);

        if (soal.tipe === 'pg') {
            div.querySelectorAll('input[type="radio"]').forEach(radio => {
                radio.addEventListener('change', () => simpanJawaban(soal.id, radio.value));
            });
        } else if (soal.tipe === 'menjodohkan') {
            const sel = div.querySelector(`select[name="soal_${soal.id}"]`);
            sel.addEventListener('change', () => simpanJawaban(soal.id, sel.value));
        }
    });
}

// ── Timer Server-Authoritative ──
function startTimer(durasiMenit, sisaDetik) {
    if (timerInterval) clearInterval(timerInterval);
    if (sisaDetik !== undefined && sisaDetik !== null) {
        waktuTersisa = Math.max(0, parseInt(sisaDetik, 10));
    } else {
        waktuTersisa = (durasiMenit || 60) * 60;
    }
    const timerEl = document.getElementById('timer');
    if (!timerEl) return;

    timerInterval = setInterval(() => {
        if (waktuTersisa <= 0) {
            clearInterval(timerInterval);
            selesaiUjian();
            return;
        }
        const m = Math.floor(waktuTersisa / 60);
        const s = waktuTersisa % 60;
        timerEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        timerEl.classList.remove('warning', 'danger');
        if (waktuTersisa <= 60)       timerEl.classList.add('danger');
        else if (waktuTersisa <= 300) timerEl.classList.add('warning');
        if (waktuTersisa === 60) showWarning('⚠️ Waktu tersisa 1 menit! Pastikan jawaban sudah tersimpan.');
        waktuTersisa--;
    }, 1000);
}

function showWarning(message) {
    const toast   = document.getElementById('warningToast');
    const msgSpan = document.getElementById('warningMessage');
    if (toast && msgSpan) {
        msgSpan.innerText = message;
        toast.style.display = 'flex';
        setTimeout(() => { toast.style.display = 'none'; }, 4000);
    }
}

// ── Anti-cheat copy-paste ──
function detectCopyPaste() {
    ['copy','paste','cut'].forEach(evt => {
        document.addEventListener(evt, (e) => {
            e.preventDefault();
            socket.emit('copy-paste');
            alert(evt === 'paste' ? 'Menempel teks tidak diperbolehkan!'
                : evt === 'cut'   ? 'Memotong teks tidak diperbolehkan!'
                                  : 'Menyalin teks tidak diperbolehkan!');
        });
    });
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        socket.emit('copy-paste');
        alert('Klik kanan tidak diperbolehkan!');
    });
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && ['c','v','x'].includes(e.key)) {
            e.preventDefault();
            socket.emit('copy-paste');
            alert('Copy-paste tidak diperbolehkan!');
        }
    });
}
detectCopyPaste();

// ── Selesai & Finalisasi Ujian ──
async function selesaiUjian() {
    if (ujianSudahSelesai) return;
    ujianSudahSelesai = true;

    if (timerInterval) clearInterval(timerInterval);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (resyncTimerInterval) clearInterval(resyncTimerInterval);
    stopPolling();

    const btnSelesai = document.getElementById('btn-selesai');
    if (btnSelesai) {
        btnSelesai.disabled = true;
        btnSelesai.textContent = 'Mengumpulkan jawaban...';
    }

    // Kirim seluruh sisa antrean yang belum terkirim
    await kirimAntrian();

    try {
        const res = await fetch('/api/selesai-ujian', {
            method:      'POST',
            credentials: 'same-origin'
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            console.warn('selesai-ujian API error:', errData.error);
        }

        const data = await res.json().catch(() => ({}));

        // Bersihkan data ujian ini dari storage
        localStorage.removeItem(KEY_LOCAL_ANSWERS);
        localStorage.removeItem(KEY_QUEUE);

        if (data.nilai !== undefined) {
            alert(
                `✅ Ujian selesai!\n\n` +
                `Nilai Anda : ${data.nilai}\n` +
                `Benar      : ${data.benar}\n` +
                `Salah      : ${data.salah}\n` +
                `Kosong     : ${data.kosong}`
            );
        }

        socket.emit('selesai-ujian');
        window.location.href = '/logout';

    } catch (e) {
        console.error('selesaiUjian fetch error:', e);
        socket.emit('selesai-ujian');
        window.location.href = '/logout';
    }
}

// ── Socket Events ──
socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
    socket.emit('siswa-siap', { ujian_id: ujianId, siswa_id: siswaId });
});

socket.on('mulai-ujian', ({ durasi, sisa_detik }) => {
    console.log('mulai-ujian, sisa_detik:', sisa_detik, 'durasi:', durasi);
    startTimer(durasi, sisa_detik);
    loadSoal();
    startPolling();
    startHeartbeat();
    startResyncTimer();
});

socket.on('paksa-submit', () => {
    showWarning('⚠️ Anda telah melanggar aturan! Ujian akan diakhiri.');
    setTimeout(() => selesaiUjian(), 1000);
});

socket.on('peringatan', ({ pesan }) => showWarning(pesan));

socket.on('error', ({ message }) => {
    alert(message);
    window.location.href = '/login';
});

socket.on('reconnect', () => {
    console.log('Socket reconnected');
    cekStatusUjianDariServer();
    resinkronTimer();
    kirimAntrian();
});

// ── Deteksi Pindah Tab & Resinkron Timer saat Tab Aktif (T1.7) ──
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        socket.emit('pindah-tab');
    } else {
        // Tab aktif kembali: resinkron timer dan flush antrean jawaban
        resinkronTimer();
        kirimAntrian();
    }
});

// ── Tombol Selesai Manual ──
const btnSelesai = document.getElementById('btn-selesai');
if (btnSelesai) {
    btnSelesai.addEventListener('click', () => {
        if (confirm('Yakin ingin mengumpulkan ujian? Jawaban yang sudah tersimpan akan dinilai.')) {
            selesaiUjian();
        }
    });
}

// ── Cegah Refresh Tanpa Sengaja ──
window.addEventListener('beforeunload', (e) => {
    if (timerInterval && waktuTersisa > 0 && !ujianSudahSelesai) {
        e.preventDefault();
        e.returnValue = 'Anda sedang mengerjakan ujian. Yakin ingin meninggalkan halaman?';
    }
});