<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
    <title>Ujian CBT - <%= siswa.nama %></title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            background: #f5f7fa;
            font-family: 'Segoe UI', 'Inter', system-ui, -apple-system, sans-serif;
            padding: 20px;
            min-height: 100vh;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
        }
        
        /* Header Ujian - minimalis */
        .exam-header {
            background: white;
            border-radius: 16px;
            padding: 16px 24px;
            margin-bottom: 24px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03);
            border: 1px solid #e9ecef;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 15px;
        }
        .exam-title {
            font-size: 1rem;
            font-weight: 600;
            color: #2c3e50;
        }
        .exam-title i {
            color: #2ecc71;
            margin-right: 8px;
        }
        .exam-title .small {
            font-size: 0.75rem;
            font-weight: normal;
            color: #7f8c8d;
            margin-top: 4px;
        }
        .timer-box {
            background: #f8f9fa;
            padding: 8px 20px;
            border-radius: 40px;
            border: 1px solid #e9ecef;
            text-align: center;
            min-width: 140px;
        }
        .timer-label {
            font-size: 0.7rem;
            color: #7f8c8d;
            letter-spacing: 0.5px;
        }
        .timer-value {
            font-size: 1.6rem;
            font-weight: 600;
            color: #2c3e50;
            font-family: 'JetBrains Mono', monospace;
            letter-spacing: 1px;
        }
        
        /* Progress bar */
        .progress-wrapper {
            background: #e9ecef;
            border-radius: 20px;
            height: 6px;
            margin-bottom: 24px;
            overflow: hidden;
        }
        .progress-bar-custom {
            background: #2ecc71;
            width: 0%;
            height: 100%;
            border-radius: 20px;
            transition: width 0.3s ease;
        }
        
        /* Card Soal */
        .soal-card {
            background: white;
            border-radius: 16px;
            padding: 20px 24px;
            margin-bottom: 16px;
            border: 1px solid #e9ecef;
            transition: box-shadow 0.2s ease;
        }
        .soal-card:hover {
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }
        .soal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid #f0f2f4;
        }
        .soal-number {
            background: #e8f5e9;
            color: #2e7d32;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .soal-poin {
            color: #7f8c8d;
            font-size: 0.7rem;
            background: #f8f9fa;
            padding: 4px 10px;
            border-radius: 20px;
        }
        .soal-text {
            font-size: 0.95rem;
            line-height: 1.5;
            margin-bottom: 20px;
            color: #2c3e50;
        }
        
        /* Pilihan Ganda */
        .pilihan-ganda .form-check {
            margin-bottom: 10px;
            padding: 8px 12px;
            border-radius: 12px;
            transition: background 0.2s;
            cursor: pointer;
            border: 1px solid transparent;
        }
        .pilihan-ganda .form-check:hover {
            background: #f8f9fa;
            border-color: #e9ecef;
        }
        .form-check-input {
            cursor: pointer;
            width: 1.1rem;
            height: 1.1rem;
            margin-top: 0.1rem;
            accent-color: #2ecc71;
        }
        .form-check-label {
            cursor: pointer;
            margin-left: 10px;
            font-size: 0.9rem;
            color: #34495e;
        }
        
        /* Menjodohkan & Essay */
        .menjodohkan select, .essay textarea {
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            padding: 10px 14px;
            font-size: 0.9rem;
            transition: all 0.2s;
        }
        .menjodohkan select:focus, .essay textarea:focus {
            border-color: #2ecc71;
            box-shadow: 0 0 0 3px rgba(46,204,113,0.1);
            outline: none;
        }
        
        /* Tombol Submit */
        .btn-submit {
            background: #2ecc71;
            border: none;
            padding: 12px 32px;
            font-size: 0.95rem;
            font-weight: 500;
            border-radius: 40px;
            transition: all 0.2s;
            margin: 16px 0 40px;
            color: white;
        }
        .btn-submit:hover {
            background: #27ae60;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(46,204,113,0.3);
        }
        .btn-submit:active {
            transform: translateY(0);
        }
        
        /* Toast Peringatan */
        .warning-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 1000;
            background: white;
            color: #e67e22;
            padding: 12px 20px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            display: none;
            align-items: center;
            gap: 10px;
            font-size: 0.85rem;
            border-left: 4px solid #e67e22;
            animation: slideIn 0.3s ease;
        }
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        /* Loading */
        .loading {
            text-align: center;
            padding: 60px;
            background: white;
            border-radius: 16px;
            border: 1px solid #e9ecef;
        }
        .spinner {
            width: 40px;
            height: 40px;
            border: 3px solid #e9ecef;
            border-top-color: #2ecc71;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 15px;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            body { padding: 12px; }
            .exam-header { flex-direction: column; text-align: center; }
            .soal-card { padding: 16px; }
            .btn-submit { width: 100%; }
            .warning-toast { bottom: 16px; right: 16px; left: 16px; }
        }
    </style>
</head>
<body>
<div class="container">
    <!-- Header Ujian -->
    <div class="exam-header">
    <div class="exam-title d-flex align-items-center">
        <img src="/images/logo-sekolah.png" alt="Logo" style="width: 35px; height: 35px; object-fit: contain; margin-right: 12px;">
        <div>
            <i class="bi bi-laptop"></i> Ujian Online CBT
            <div class="small"><%= siswa.nama %> | NIS: <%= siswa.nis || siswa.id %></div>
        </div>
    </div>
    <div class="exam-info">
        <div><strong><%= ujian.nama_ujian %></strong> (<%= ujian.nama_mapel %>)</div>
    <div class="small">Mulai: <%= ujian.tanggal_mulai || '-' %></div>
    </div>
    <div class="timer-box">
        <div class="timer-label"><i class="bi bi-hourglass-split"></i> Waktu tersisa</div>
        <div class="timer-value" id="timer">00:00</div>
    </div>
</div>

    <!-- Progress Bar -->
    <div class="progress-wrapper">
        <div class="progress-bar-custom" id="progressBar"></div>
    </div>

    <!-- Container Soal -->
    <div id="soal-container">
        <div class="loading">
            <div class="spinner"></div>
            <div style="color: #7f8c8d;">Memuat soal...</div>
        </div>
    </div>

    <!-- Tombol Submit -->
    <div class="text-center">
        <button id="btn-selesai" class="btn-submit">
            <i class="bi bi-check2-circle"></i> Selesai & Kumpulkan
        </button>
    </div>
</div>

<!-- Toast Peringatan -->
<div id="warningToast" class="warning-toast">
    <i class="bi bi-exclamation-triangle-fill"></i>
    <span id="warningMessage">Peringatan!</span>
</div>

<script>
    window.ujianId = '<%= ujianId %>';
    window.siswaId = '<%= siswa.id %>';
    window.siswaNama = '<%= siswa.nama %>';
</script>
<script src="/socket.io/socket.io.js"></script>
<script src="/js/ujian.js"></script>
</body>
</html>