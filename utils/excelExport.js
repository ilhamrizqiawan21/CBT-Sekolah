const ExcelJS = require('exceljs');

async function exportHasilUjian(hasilData, res, filename = 'hasil_ujian.xlsx') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Hasil Ujian');
    
    worksheet.columns = [
        { header: 'NIS', key: 'nis', width: 15 },
        { header: 'Nama Siswa', key: 'siswa_nama', width: 30 },
        { header: 'Kelas', key: 'kelas', width: 15 },
        { header: 'Ujian', key: 'nama_ujian', width: 30 },
        { header: 'Poin PG+Menjodohkan', key: 'poin_otomatis', width: 22 },
        { header: 'Poin Essay', key: 'poin_essay', width: 15 },
        { header: 'Nilai Akhir', key: 'nilai', width: 12 },
        { header: 'Status Koreksi', key: 'status_koreksi', width: 18 },
        { header: 'Benar', key: 'benar', width: 10 },
        { header: 'Salah', key: 'salah', width: 10 },
        { header: 'Kosong', key: 'kosong', width: 10 },
        { header: 'Selesai Pada', key: 'selesai_pada', width: 20 }
    ];
    
    hasilData.forEach(row => {
        worksheet.addRow({
            ...row,
            poin_otomatis: row.poin_otomatis ?? 0,
            poin_essay: row.poin_essay ?? 0,
            nilai: row.nilai ?? 0,
            status_koreksi: row.status_koreksi === 'menunggu_essay' ? 'Menunggu Essay' : (row.status_koreksi === 'selesai' ? 'Selesai' : (row.status_koreksi || '-')),
            selesai_pada: row.selesai_pada ? new Date(row.selesai_pada).toLocaleString() : '-'
        });
    });
    
    // Styling header
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4E73DF' } };
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    await workbook.xlsx.write(res);
    res.end();
}

module.exports = exportHasilUjian;