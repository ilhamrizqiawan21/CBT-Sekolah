# Panduan Operasional Exambro & Safe Exam Browser (SEB)

Dokumen ini adalah panduan praktis untuk membuka aplikasi CBT Sekolah di lingkungan aplikasi pengunci ujian (**Exambro** untuk HP/Android dan **Safe Exam Browser / SEB** untuk Laptop/Komputer). Sesuai prinsip kejujuran sistem (DESIGN §3.7, DECISION D-011), aplikasi web tidak mengklaim dapat mengontrol perangkat secara mutlak dari sisi peramban biasa; oleh karena itu aplikasi pengunci eksternal digunakan sebagai benteng tambahan.

---

## 1. Penggunaan Exambro pada HP Siswa (Android / iOS)

Aplikasi CBT dirancang responsif (viewport mobile 360×640 px, target sentuh minimal 44 px, tanpa scroll horizontal) dan mendeteksi otomatis tipe perangkat sebagai `hp`. Pada HP, mode layar penuh (Fullscreen API) **tidak diwajibkan** untuk menghindari peringatan palsu saat keyboard virtual muncul.

### Langkah Membuka di Exambro:
1. **Instalasi Aplikasi:**
   - Siswa mengunduh dan memasang aplikasi Exambro resmi sekolah dari Google Play Store atau file APK yang disiapkan proktor sekolah (misal: *Exambro*, *Candy CBT Browser*, atau *FlyExam*).
2. **Memasukkan URL Ujian:**
   - Buka aplikasi Exambro.
   - Pindai kode QR yang dibagikan proktor di papan tulis/ruang kelas, atau ketik langsung URL portal ujian sekolah (misal: `https://cbt.sekolah.sch.id` atau URL IP lokal LAN/tunnel yang aktif).
3. **Mulai Ujian:**
   - Halaman login CBT akan langsung terbuka.
   - Siswa memasukkan NIS, PIN, memilih Ujian, dan memasukkan Token Ujian (jika ujian menggunakan token).
   - Setelah login, antarmuka ujian akan langsung aktif tanpa memunculkan modal overlay fullscreen desktop.
4. **Kebijakan Pelanggaran di HP:**
   - Jika siswa mencoba keluar aplikasi, meminimalisir aplikasi, membuka recent apps, atau menekan tombol navigasi sistem HP yang menyebabkan jendela browser tidak aktif, browser akan memicu event `pindah-tab`.
   - Event `pindah-tab` dan `copy-paste` tetap dicatat sebagai pelanggaran resmi dan disiarkan real-time ke Dashboard Pengawas.

---

## 2. Penggunaan Safe Exam Browser (SEB) pada Laptop / Komputer

Safe Exam Browser (SEB) mengunci lingkungan desktop (Windows / macOS) sehingga siswa tidak dapat membuka aplikasi peramban lain, berpindah jendela, atau mengambil tangkapan layar (screenshot).

### Langkah Menyiapkan Konfigurasi SEB (.seb):
1. **Instalasi SEB:**
   - Pasang versi resmi SEB (disarankan SEB 3.x untuk Windows atau versi terbaru untuk macOS) pada komputer/laptop peserta.
2. **Membuat File Konfigurasi (.seb):**
   - Buka **SEB Configuration Tool**.
   - Pada tab **General**:
     - Atur **Start URL** mengarah ke portal login CBT sekolah (misal: `https://cbt.sekolah.sch.id/login`).
   - Pada tab **Browser**:
     - Aktifkan JavaScript, Cookies, dan Local Storage (wajib untuk CBT Sekolah).
     - Nonaktifkan tombol navigasi tambahan seperti reload atau back jika diperlukan (CBT sudah menyediakan tombol navigasi mandiri).
   - Pada tab **Security**:
     - Atur password keluar (*Quit Password*) agar hanya proktor/guru yang dapat menutup aplikasi SEB saat ujian berlangsung atau selesai.
   - Simpan berkas sebagai `CBT_Sekolah.seb` dan bagikan ke laptop peserta.
3. **Mulai Ujian di SEB:**
   - Siswa cukup membuka/klik dua kali file `CBT_Sekolah.seb`.
   - SEB akan otomatis mengunci desktop dan langsung menampilkan halaman login CBT.
   - Siswa memasukkan kredensial dan mengerjakan ujian.

---

## 3. Catatan Batasan & Kejujuran Sistem (Disclaimers)

1. **Deteksi Multi-Perangkat Fisik:**
   Aplikasi CBT tidak dapat mendeteksi keberadaan HP kedua atau perangkat fisik tambahan yang ditaruh siswa di luar pandangan kamera/layar. Pengawasan tatap muka oleh proktor tetap diperlukan.
2. **Fitur Layar Penuh pada Laptop Non-SEB:**
   Jika laptop digunakan dengan browser standar (Chrome/Firefox/Edge) tanpa SEB, CBT menerapkan mode **Wajib Layar Penuh**. Siswa yang keluar dari layar penuh (menekan tombol Esc atau Alt+Tab) akan diberikan waktu hitung mundur 10 detik untuk kembali sebelum dicatat sebagai pelanggaran resmi.
3. **Ketahanan Koneksi:**
   Bila koneksi siswa di Exambro/SEB terputus, siswa tetap dapat melanjutkan ujian karena seluruh jawaban tersimpan di memori lokal (*localStorage*) dan akan disinkronkan otomatis saat koneksi pulih kembali.

