const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const penilaianService = require('../services/penilaianService');

describe('penilaianService Pure Logic (T3.2)', () => {

    test('1. Skenario PRD: 40 soal PG/menjodohkan semua benar (80 poin) + 5 soal essay bernilai 4 (20 poin) -> nilai 100', () => {
        const soalList = [];
        const jawabanMap = {};
        const skorEssay = {};

        // 35 PG (poin 2)
        for (let i = 1; i <= 35; i++) {
            soalList.push({ id: i, tipe_soal: 'pg', poin: 2, jawaban_benar: 'B' });
            jawabanMap[i] = 'B';
        }
        // 5 Menjodohkan (poin 2)
        for (let i = 36; i <= 40; i++) {
            soalList.push({
                id: i,
                tipe_soal: 'menjodohkan',
                poin: 2,
                jawaban_benar: JSON.stringify([{ kiri: '1', kanan: 'A' }, { kiri: '2', kanan: 'B' }])
            });
            jawabanMap[i] = [{ kiri: '1', kanan: 'A' }, { kiri: '2', kanan: 'B' }];
        }
        // 5 Essay (poin 4)
        for (let i = 41; i <= 45; i++) {
            soalList.push({ id: i, tipe_soal: 'essay', poin: 4 });
            skorEssay[i] = 4;
        }

        const hasil = penilaianService.hitung({ soalList, jawabanMap, skorEssay });

        assert.strictEqual(hasil.poin_otomatis, 80);
        assert.strictEqual(hasil.poin_essay, 20);
        assert.strictEqual(hasil.poin_maks, 100);
        assert.strictEqual(hasil.nilai, 100);
        assert.strictEqual(hasil.benar, 40);
        assert.strictEqual(hasil.salah, 0);
        assert.strictEqual(hasil.kosong, 0);
        assert.strictEqual(hasil.status_koreksi, 'selesai');
    });

    test('2. Skenario PRD: 30 benar dari 40 soal PG (60 poin) + essay 12 dari 20 -> (60+12)/100 = 72', () => {
        const soalList = [];
        const jawabanMap = {};
        const skorEssay = {};

        // 40 PG (poin 2, maks 80)
        for (let i = 1; i <= 40; i++) {
            soalList.push({ id: i, tipe_soal: 'pg', poin: 2, jawaban_benar: 'A' });
            // 30 jawab 'A' (benar), 10 jawab 'C' (salah)
            jawabanMap[i] = i <= 30 ? 'A' : 'C';
        }
        // 5 Essay (poin 4, maks 20) -> total skor 12
        soalList.push({ id: 41, tipe_soal: 'essay', poin: 4 }); skorEssay[41] = 3;
        soalList.push({ id: 42, tipe_soal: 'essay', poin: 4 }); skorEssay[42] = 3;
        soalList.push({ id: 43, tipe_soal: 'essay', poin: 4 }); skorEssay[43] = 2;
        soalList.push({ id: 44, tipe_soal: 'essay', poin: 4 }); skorEssay[44] = 2;
        soalList.push({ id: 45, tipe_soal: 'essay', poin: 4 }); skorEssay[45] = 2; // total = 12

        const hasil = penilaianService.hitung({ soalList, jawabanMap, skorEssay });

        assert.strictEqual(hasil.poin_otomatis, 60);
        assert.strictEqual(hasil.poin_essay, 12);
        assert.strictEqual(hasil.poin_maks, 100);
        assert.strictEqual(hasil.nilai, 72);
        assert.strictEqual(hasil.benar, 30);
        assert.strictEqual(hasil.salah, 10);
        assert.strictEqual(hasil.kosong, 0);
        assert.strictEqual(hasil.status_koreksi, 'selesai');
    });

    test('3. Ada essay belum dinilai -> status_koreksi = "menunggu_essay"', () => {
        const soalList = [
            { id: 1, tipe_soal: 'pg', poin: 2, jawaban_benar: 'A' },
            { id: 2, tipe_soal: 'essay', poin: 4 }
        ];
        const jawabanMap = { 1: 'A' };
        const skorEssay = {}; // Essay belum dinilai guru

        const hasil = penilaianService.hitung({ soalList, jawabanMap, skorEssay });

        assert.strictEqual(hasil.poin_otomatis, 2);
        assert.strictEqual(hasil.poin_essay, 0);
        assert.strictEqual(hasil.poin_maks, 6);
        assert.strictEqual(hasil.status_koreksi, 'menunggu_essay');
    });

    test('4. Menjodohkan: aturan all-or-nothing (salah satu pasangan salah -> 0 poin)', () => {
        const soalList = [
            {
                id: 1,
                tipe_soal: 'menjodohkan',
                poin: 2,
                jawaban_benar: JSON.stringify([
                    { kiri: 'Presiden RI ke-1', kanan: 'Soekarno' },
                    { kiri: 'Presiden RI ke-2', kanan: 'Soeharto' }
                ])
            }
        ];

        // Siswa menjawab satu benar satu salah
        const jawabanSalah = [
            { kiri: 'Presiden RI ke-1', kanan: 'Soekarno' },
            { kiri: 'Presiden RI ke-2', kanan: 'Habibie' }
        ];

        const hasilSalah = penilaianService.hitung({
            soalList,
            jawabanMap: { 1: jawabanSalah }
        });
        assert.strictEqual(hasilSalah.poin_otomatis, 0);
        assert.strictEqual(hasilSalah.benar, 0);
        assert.strictEqual(hasilSalah.salah, 1);

        // Siswa menjawab semua pasangan dengan benar (bahkan jika urutan array berbeda)
        const jawabanBenar = [
            { kiri: 'Presiden RI ke-2', kanan: 'Soeharto' },
            { kiri: 'Presiden RI ke-1', kanan: 'Soekarno' }
        ];
        const hasilBenar = penilaianService.hitung({
            soalList,
            jawabanMap: { 1: jawabanBenar }
        });
        assert.strictEqual(hasilBenar.poin_otomatis, 2);
        assert.strictEqual(hasilBenar.benar, 1);
        assert.strictEqual(hasilBenar.salah, 0);
    });

    test('5. Ujian tanpa essay -> status_koreksi langsung "selesai"', () => {
        const soalList = [
            { id: 1, tipe_soal: 'pg', poin: 2, jawaban_benar: 'C' },
            { id: 2, tipe_soal: 'pg', poin: 2, jawaban_benar: 'D' }
        ];
        const jawabanMap = { 1: 'C', 2: 'A' }; // 1 benar, 1 salah

        const hasil = penilaianService.hitung({ soalList, jawabanMap });

        assert.strictEqual(hasil.poin_otomatis, 2);
        assert.strictEqual(hasil.poin_essay, 0);
        assert.strictEqual(hasil.poin_maks, 4);
        assert.strictEqual(hasil.nilai, 50);
        assert.strictEqual(hasil.status_koreksi, 'selesai');
    });

    test('6. Soal tidak dijawab dihitung kosong dan bernilai 0', () => {
        const soalList = [
            { id: 1, tipe_soal: 'pg', poin: 2, jawaban_benar: 'A' },
            { id: 2, tipe_soal: 'pg', poin: 2, jawaban_benar: 'B' },
            { id: 3, tipe_soal: 'menjodohkan', poin: 2, jawaban_benar: '[{"kiri":"1","kanan":"A"}]' }
        ];
        const jawabanMap = { 1: 'A' }; // soal 2 dan 3 kosong

        const hasil = penilaianService.hitung({ soalList, jawabanMap });
        assert.strictEqual(hasil.benar, 1);
        assert.strictEqual(hasil.salah, 0);
        assert.strictEqual(hasil.kosong, 2);
        assert.strictEqual(hasil.poin_otomatis, 2);
        assert.strictEqual(hasil.poin_maks, 6);
        assert.strictEqual(hasil.nilai, 33); // round(2/6 * 100) = 33
    });
});

