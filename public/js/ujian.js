const ujianId = window.ujianId;
const siswaId = window.siswaId;
let waktuTersisa    = 0;
let timerInterval   = null;
let offlineQueue    = [];
let totalSoal       = 0;
let terjawab        = 0;
let pollingInterval = null;
// FIX #10 — flag untuk pastikan selesaiUjian hanya jalan sekali
let ujianSudahSelesai = false;

// ─────────────────────────────────────────────
// FIX #2 — localStorage hanya simpan flag soal
// yang sudah dijawab, bukan nilai jawaban.
// Offline queue di sessionStorage (tab saja).
// ─────────────────────────────────────────────
const KEY_ANSWERED = `answered_${siswaId}_${ujianId}`;
const KEY_QUEUE    = `queue_${siswaId}_${ujianId}`;

const socket = io();

function loadQueue() {
    try { return JSON.parse(sessionStorage.getItem(KEY_QUEUE) || '[]'); }
    catch { return []; }
}
function saveQueue(q) {
    try { sessionStorage.setItem(KEY_QUEUE, JSON.stringify(q)); } catch {}
}
offlineQueue = loadQueue();

function getAnsweredSet() {
    try { return new Set(JSON.parse(localStorage.getItem(KEY_ANSWERED) || '[]')); }
    catch { return new Set(); }
}
function saveAnsweredSet(set) {
    try { localStorage.setItem(KEY_ANSWERED, JSON.stringify([...set])); } catch {}
}
function markAnswered(soal_id) {
    const s = getAnsweredSet(); s.add(String(soal_id)); saveAnsweredSet(s);
}
function isAnswered(soal_id) {
    return getAnsweredSet().has(String(soal_id));
}

// ── Progress bar ──
function updateProgress() {
    if (totalSoal > 0) {
        const bar = document.getElementById('progressBar');
        if (bar) bar.style.width = (terjawab / totalSoal * 100) + '%';
    }
}
function hitungTerjawab() {
    terjawab = getAnsweredSet().size;
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

// ── Simpan jawaban ──
async function simpanJawaban(soal_id, jawaban) {
    markAnswered(soal_id);
    hitungTerjawab();
    offlineQueue.push({ soal_id, jawaban });
    saveQueue(offlineQueue);
    await kirimAntrian();
}

async function kirimAntrian() {
    if (!offlineQueue.length) return;
    const copy = [...offlineQueue];
    for (const item of copy) {
        try {
            const res = await fetch('/api/simpan-jawaban', {
                method:      'POST',
                headers:     { 'Content-Type': 'application/json' },
                body:        JSON.stringify({ ujian_id: ujianId, soal_id: item.soal_id, jawaban: item.jawaban }),
                credentials: 'same-origin'
            });
            if (res.ok) {
                offlineQueue = offlineQueue.filter(
                    q => !(q.soal_id === item.soal_id && q.jawaban === item.jawaban)
                );
                saveQueue(offlineQueue);
            }
        } catch { break; }
    }
}
setInterval(() => { if (navigator.onLine) kirimAntrian(); }, 30000);
window.addEventListener('online', () => kirimAntrian());

// ─────────────────────────────────────────────
// FIX #4 — Polling server-side sebagai fallback
// Setiap 15 detik cek status ujian ke server
// tanpa bergantung pada socket.
// ─────────────────────────────────────────────
async function cekStatusUjianDariServer() {
    try {
        const res = await fetch('/api/cek-status-ujian', { credentials: 'same-origin' });
        if (res.status === 401) { window.location.href = '/login'; return; }
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
    } catch { /* jaringan putus sementara, coba lagi */ }
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

// ── Load soal ──
async function loadSoal() {
    try {
        const res = await fetch(`/api/soal/${ujianId}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const soal = await res.json();
        if (soal.error) throw new Error(soal.error);
        totalSoal = soal.length;
        hitungTerjawab();
        buildNavGrid(soal);
        renderSoal(soal);
    } catch (err) {
        console.error(err);
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

        if (soal.tipe === 'pg') {
            html += `<div class="pilihan-ganda">`;
            soal.pilihan.forEach(p => {
                html += `
                    <div class="form-check" onclick="this.querySelector('input').click()">
                        <input class="form-check-input" type="radio"
                               name="soal_${soal.id}" value="${p.key}"
                               id="q_${soal.id}_${p.key}">
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
                html += `<option value="${p.kanan}">${p.kiri} → ${p.kanan}</option>`;
            });
            (soal.pengecoh || []).forEach(p => {
                html += `<option value="${p}">${p}</option>`;
            });
            html += `</select></div>`;
        }
        else if (soal.tipe === 'essay') {
            html += `<div class="essay mb-3">
                <textarea class="form-control" name="soal_${soal.id}"
                          rows="4" placeholder="Tulis jawaban Anda di sini..."></textarea>
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
        } else if (soal.tipe === 'essay') {
            const ta = div.querySelector(`textarea[name="soal_${soal.id}"]`);
            let t;
            ta.addEventListener('input', () => {
                clearTimeout(t);
                t = setTimeout(() => simpanJawaban(soal.id, ta.value), 500);
            });
        }
    });
}

// ── Timer ──
function startTimer(durasiMenit) {
    if (timerInterval) clearInterval(timerInterval);
    waktuTersisa = durasiMenit * 60;
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

// ─────────────────────────────────────────────
// FIX #10 — selesaiUjian() WAJIB panggil
// /api/selesai-ujian terlebih dulu sebelum
// emit socket 'selesai-ujian'.
//
// Sebelumnya siswa bisa:
//   socket.emit('selesai-ujian')  ← dari console
// tanpa memanggil API, sehingga nilai tidak
// tersimpan dan bisa login ulang lagi.
//
// Sekarang:
//   1. Kirim antrian jawaban yang belum terkirim
//   2. Panggil POST /api/selesai-ujian (wajib berhasil)
//   3. Baru emit socket 'selesai-ujian'
//   4. Redirect ke /logout
//
// Flag ujianSudahSelesai mencegah double-call
// jika timer habis bersamaan dengan klik tombol.
// ─────────────────────────────────────────────
async function selesaiUjian() {
    // FIX #10 — Cegah eksekusi ganda
    if (ujianSudahSelesai) return;
    ujianSudahSelesai = true;

    if (timerInterval) clearInterval(timerInterval);
    stopPolling();

    // Kunci tombol selesai agar tidak bisa diklik lagi
    const btnSelesai = document.getElementById('btn-selesai');
    if (btnSelesai) {
        btnSelesai.disabled = true;
        btnSelesai.textContent = 'Mengumpulkan jawaban...';
    }

    // Kirim semua antrian yang belum terkirim
    await kirimAntrian();

    try {
        // FIX #10 — API HARUS berhasil dulu sebelum emit socket
        const res  = await fetch('/api/selesai-ujian', {
            method:      'POST',
            credentials: 'same-origin'
        });

        if (!res.ok) {
            // Jika server reject (misal waktu habis), tetap redirect
            const errData = await res.json().catch(() => ({}));
            console.warn('selesai-ujian API error:', errData.error);
        }

        const data = await res.json().catch(() => ({}));

        // Bersihkan storage
        sessionStorage.removeItem(KEY_QUEUE);

        // Tampilkan hasil jika ada
        if (data.nilai !== undefined) {
            alert(
                `✅ Ujian selesai!\n\n` +
                `Nilai Anda : ${data.nilai}\n` +
                `Benar      : ${data.benar}\n` +
                `Salah      : ${data.salah}\n` +
                `Kosong     : ${data.kosong}`
            );
        }

        // FIX #10 — Emit socket SETELAH API berhasil
        // Ini update status sesi_ujian ke 'selesai' di server
        socket.emit('selesai-ujian');

        // Redirect ke logout
        window.location.href = '/logout';

    } catch (e) {
        // Jika jaringan putus total, tetap emit socket dan redirect
        console.error('selesaiUjian fetch error:', e);
        socket.emit('selesai-ujian');
        window.location.href = '/logout';
    }
}

// ── Socket events ──
socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
    socket.emit('siswa-siap', { ujian_id: ujianId, siswa_id: siswaId });
});

socket.on('mulai-ujian', ({ durasi }) => {
    console.log('mulai-ujian, durasi:', durasi);
    startTimer(durasi);
    loadSoal();
    startPolling();
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
});

// ── Deteksi pindah tab ──
document.addEventListener('visibilitychange', () => {
    if (document.hidden) socket.emit('pindah-tab');
});

// ── Tombol selesai manual ──
const btnSelesai = document.getElementById('btn-selesai');
if (btnSelesai) {
    btnSelesai.addEventListener('click', () => {
        if (confirm('Yakin ingin mengumpulkan ujian? Jawaban yang sudah tersimpan akan dinilai.')) {
            selesaiUjian();
        }
    });
}

// ── Cegah refresh tanpa sengaja ──
window.addEventListener('beforeunload', (e) => {
    if (timerInterval && waktuTersisa > 0 && !ujianSudahSelesai) {
        e.preventDefault();
        e.returnValue = 'Anda sedang mengerjakan ujian. Yakin ingin meninggalkan halaman?';
    }
});