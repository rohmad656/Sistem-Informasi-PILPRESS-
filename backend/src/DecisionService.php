<?php
declare(strict_types=1);

namespace Gdss;

use InvalidArgumentException;

/**
 * Service untuk kalkulasi matematika Sistem Pendukung Keputusan Kelompok (GDSS)
 * Mengimplementasikan:
 * 1. Simple Additive Weighting (SAW) dengan normalisasi benefit/cost
 * 2. Metode Borda dengan penanganan ranking seri (average points sharing)
 * 3. Logika Konsensus Voting Langsung (Mayoritas 2/3 dan Putaran Ulang Seri 1-1-1)
 */
final class DecisionService
{
    /**
     * Validasi nilai skor mentah kriteria (harus bilangan bulat 1 - 5)
     */
    public function validateScore(mixed $value): int
    {
        if (!is_int($value) && !(is_string($value) && ctype_digit($value))) {
            throw new InvalidArgumentException('Nilai penilaian harus berupa bilangan bulat antara 1 sampai 5.');
        }
        $score = (int)$value;
        if ($score < 1 || $score > 5) {
            throw new InvalidArgumentException('Skala penilaian harus berada pada rentang 1 sampai 5.');
        }
        return $score;
    }

    /**
     * Perhitungan Technique for Order of Preference by Similarity to Ideal Solution (TOPSIS)
     *
     * Rumus TOPSIS:
     * 1. Normalisasi vektor:     r_ij = x_ij / sqrt(Σ x_ij²)
     * 2. Normalisasi bobot:      w_j  = weight_j / 100
     * 3. Matriks terbobot:       y_ij = w_j × r_ij
     * 4. Solusi ideal:
     *    - Benefit: A+ = max(y_j), A− = min(y_j)
     *    - Cost:    A+ = min(y_j), A− = max(y_j)
     * 5. Jarak ke solusi ideal:
     *    D+ = sqrt(Σ(y_ij − A+_j)²)
     *    D− = sqrt(Σ(y_ij − A−_j)²)
     * 6. Nilai preferensi:       C_i = D− / (D+ + D−)
     *
     * Hasil C_i berada dalam rentang [0, 1]. Semakin mendekati 1 semakin baik.
     *
     * @param array $criteria Daftar kriteria [['id' => 1, 'code' => 'C1', 'weight' => 25, 'type' => 'benefit'], ...]
     * @param array $matrix   Matriks alternatif [['candidate_id' => 1, 'scores' => [1 => 5, 2 => 5, 3 => 4, 4 => 4]], ...]
     * @return array Hasil TOPSIS terurut dengan ranking dan rincian per kriteria
     */
    public function calculateTopsis(array $criteria, array $matrix): array
    {
        if (empty($criteria) || empty($matrix)) {
            throw new InvalidArgumentException('Kriteria dan matriks penilaian tidak boleh kosong.');
        }

        // Validasi ID kandidat: harus unik dan positif (menjaga pasangan kandidat-kriteria unik)
        $seenCandidates = [];
        foreach ($matrix as $row) {
            $candidateId = $row['candidate_id'] ?? null;
            if (!is_int($candidateId) || $candidateId <= 0) {
                throw new InvalidArgumentException('ID kandidat harus berupa bilangan bulat positif.');
            }
            if (isset($seenCandidates[$candidateId])) {
                throw new InvalidArgumentException('Duplikat kandidat dalam matriks penilaian tidak diperbolehkan.');
            }
            $seenCandidates[$candidateId] = true;
        }

        $totalWeight = array_sum(array_column($criteria, 'weight'));
        if ($totalWeight !== 100) {
            throw new InvalidArgumentException('Total bobot kriteria harus berjumlah tepat 100.');
        }

        // Validasi ID, bobot per kriteria dan tipe kriteria
        foreach ($criteria as $criterion) {
            $cId = $criterion['id'] ?? null;
            if (!is_int($cId) || $cId <= 0) {
                throw new InvalidArgumentException('ID kriteria harus berupa bilangan bulat positif.');
            }
            $weight = $criterion['weight'] ?? null;
            if (!is_int($weight) && !(is_string($weight) && ctype_digit($weight))) {
                throw new InvalidArgumentException('Bobot harus bilangan bulat antara 1 sampai 100.');
            }
            if ((int)$weight < 1 || (int)$weight > 100) {
                throw new InvalidArgumentException('Bobot harus bilangan bulat antara 1 sampai 100.');
            }
            $type = strtolower($criterion['type'] ?? 'benefit');
            if (!in_array($type, ['benefit', 'cost'], true)) {
                throw new InvalidArgumentException('Tipe kriteria harus bernilai benefit atau cost.');
            }
        }

        // 1. Hitung sum of squares per kriteria (denominator normalisasi vektor)
        $sumSquares = [];
        foreach ($criteria as $criterion) {
            $cId = $criterion['id'];
            $sumSq = 0.0;
            foreach ($matrix as $row) {
                $val = $this->validateScore($row['scores'][$cId] ?? null);
                $sumSq += $val * $val;
            }
            if ($sumSq === 0.0) {
                throw new InvalidArgumentException("Jumlah kuadrat skor untuk kriteria {$cId} bernilai nol; pembagian tidak valid.");
            }
            $sumSquares[$cId] = sqrt($sumSq);
        }

        // 2. Normalisasi bobot
        $normWeights = [];
        foreach ($criteria as $criterion) {
            $normWeights[$criterion['id']] = $criterion['weight'] / 100.0;
        }

        // 3. Hitung matriks ternormalisasi terbobot (y_ij) untuk semua kandidat
        $weightedMatrix = [];
        foreach ($matrix as $row) {
            $candidateId = (int)$row['candidate_id'];
            $weightedMatrix[$candidateId] = [];
            foreach ($criteria as $criterion) {
                $cId = $criterion['id'];
                $rawScore = $this->validateScore($row['scores'][$cId] ?? null);
                $r = $rawScore / $sumSquares[$cId];
                $y = $r * $normWeights[$cId];
                $weightedMatrix[$candidateId][$cId] = $y;
            }
        }

        // 4. Tentukan solusi ideal positif (A+) dan negatif (A−) per kriteria
        $idealPos = [];
        $idealNeg = [];
        foreach ($criteria as $criterion) {
            $cId = $criterion['id'];
            $type = strtolower($criterion['type'] ?? 'benefit');
            $values = array_column($weightedMatrix, $cId);
            if ($type === 'benefit') {
                $idealPos[$cId] = max($values);
                $idealNeg[$cId] = min($values);
            } else { // cost
                $idealPos[$cId] = min($values);
                $idealNeg[$cId] = max($values);
            }
        }

        // 5. Hitung jarak ke solusi ideal dan nilai preferensi
        $results = [];
        foreach ($matrix as $row) {
            $candidateId = (int)$row['candidate_id'];
            $breakdown = [];
            $dPlusSq = 0.0;
            $dMinusSq = 0.0;

            foreach ($criteria as $criterion) {
                $cId = $criterion['id'];
                $cCode = $criterion['code'] ?? ('C' . $cId);
                $weight = (int)$criterion['weight'];
                $rawScore = $this->validateScore($row['scores'][$cId] ?? null);

                $r = $rawScore / $sumSquares[$cId];
                $w = $normWeights[$cId];
                $y = $r * $w;

                $dPlusSq   += ($y - $idealPos[$cId]) ** 2;
                $dMinusSq  += ($y - $idealNeg[$cId]) ** 2;

                $breakdown[$cId] = [
                    'criterion_id' => $cId,
                    'code' => $cCode,
                    'raw_score' => $rawScore,
                    'sum_squares' => $sumSquares[$cId],
                    'normalized' => round($r, 6),
                    'weight' => $weight,
                    'norm_weight' => round($w, 6),
                    'weighted_normalized' => round($y, 6),
                    'ideal_positive' => round($idealPos[$cId], 6),
                    'ideal_negative' => round($idealNeg[$cId], 6),
                ];
            }

            $dPlus  = sqrt($dPlusSq);
            $dMinus = sqrt($dMinusSq);

            // Edge case: semua alternatif identik -> D+ + D− = 0
            // Beri preferensi 0.5 untuk semua (netral) agar tidak NaN/INF
            if ($dPlus + $dMinus === 0.0) {
                $preference = 0.5;
            } else {
                $preference = $dMinus / ($dPlus + $dMinus);
            }

            $results[] = [
                'candidate_id' => $candidateId,
                'final_score' => $preference,
                'd_plus' => $dPlus,
                'd_minus' => $dMinus,
                'breakdown' => $breakdown,
            ];
        }

        // 6. Urutkan berdasarkan final_score menurun
        usort($results, function ($a, $b) {
            if (abs($b['final_score'] - $a['final_score']) > 0.000000001) {
                return $b['final_score'] <=> $a['final_score'];
            }
            return $a['candidate_id'] <=> $b['candidate_id'];
        });

        // 7. Hitung peringkat (dengan penanganan tie konsisten)
        $currentRank = 1;
        $count = count($results);
        for ($i = 0; $i < $count; $i++) {
            if ($i > 0 && abs($results[$i]['final_score'] - $results[$i - 1]['final_score']) < 0.000001) {
                $results[$i]['rank'] = $results[$i - 1]['rank'];
            } else {
                $results[$i]['rank'] = $i + 1;
            }
        }

        return $results;
    }

    /**
     * Perhitungan Simple Additive Weighting (SAW)
     * 
     * @param array $criteria Daftar kriteria [['id' => 1, 'code' => 'C1', 'weight' => 25, 'type' => 'benefit'], ...]
     * @param array $matrix Matriks alternatif [['candidate_id' => 1, 'scores' => [1 => 5, 2 => 5, 3 => 4, 4 => 4]], ...]
     * @return array Hasil SAW terurut dengan ranking dan rincian normalisasi/pembobotan
     */
    public function calculateSaw(array $criteria, array $matrix): array
    {
        if (empty($criteria) || empty($matrix)) {
            throw new InvalidArgumentException('Kriteria dan matriks penilaian tidak boleh kosong.');
        }

        $totalWeight = array_sum(array_column($criteria, 'weight'));
        if ($totalWeight !== 100) {
            throw new InvalidArgumentException('Total bobot kriteria harus berjumlah tepat 100.');
        }

        // 1. Tentukan nilai ekstrim (max untuk benefit, min untuk cost)
        $extremes = [];
        foreach ($criteria as $criterion) {
            $type = strtolower($criterion['type'] ?? 'benefit');
            if (!in_array($type, ['benefit', 'cost'], true)) {
                throw new InvalidArgumentException('Tipe kriteria harus bernilai benefit atau cost.');
            }
            $extremes[$criterion['id']] = ($type === 'benefit') ? 0 : PHP_INT_MAX;
        }

        foreach ($matrix as $row) {
            foreach ($criteria as $criterion) {
                $cId = $criterion['id'];
                $val = $this->validateScore($row['scores'][$cId] ?? null);
                if ($criterion['type'] === 'benefit') {
                    $extremes[$cId] = max($extremes[$cId], $val);
                } else {
                    $extremes[$cId] = min($extremes[$cId], $val);
                }
            }
        }

        // Cegah pembagian dengan nol
        foreach ($extremes as $cId => $best) {
            if ($best === 0) {
                throw new InvalidArgumentException('Nilai pembagi normalisasi tidak boleh nol.');
            }
        }

        // 2. Normalisasi matriks (r_ij) dan perkalian bobot (w_j * r_ij)
        $results = [];
        foreach ($matrix as $row) {
            $candidateId = (int)$row['candidate_id'];
            $breakdown = [];
            $totalScore = 0.0;

            foreach ($criteria as $criterion) {
                $cId = $criterion['id'];
                $cCode = $criterion['code'] ?? ('C' . $cId);
                $weight = (int)$criterion['weight'];
                $type = $criterion['type'];
                $rawScore = $this->validateScore($row['scores'][$cId] ?? null);
                $bestVal = $extremes[$cId];

                // Normalisasi benefit: r_ij = x_ij / max(x_j)
                // Normalisasi cost:    r_ij = min(x_j) / x_ij
                $normalized = ($type === 'benefit') ? ($rawScore / $bestVal) : ($bestVal / $rawScore);
                $weighted = $normalized * $weight;

                $breakdown[$cId] = [
                    'criterion_id' => $cId,
                    'code' => $cCode,
                    'raw_score' => $rawScore,
                    'best_value' => $bestVal,
                    'normalized' => round($normalized, 6),
                    'weight' => $weight,
                    'weighted_score' => round($weighted, 6),
                ];

                $totalScore += $weighted;
            }

            $results[] = [
                'candidate_id' => $candidateId,
                'final_score' => round($totalScore, 4),
                'breakdown' => $breakdown,
            ];
        }

        // 3. Urutkan berdasarkan final_score menurun
        usort($results, function ($a, $b) {
            if (abs($b['final_score'] - $a['final_score']) > 0.00001) {
                return $b['final_score'] <=> $a['final_score'];
            }
            return $a['candidate_id'] <=> $b['candidate_id'];
        });

        // 4. Hitung peringkat (dengan dukungan penanganan ranking seri)
        $currentRank = 1;
        $count = count($results);
        for ($i = 0; $i < $count; $i++) {
            if ($i > 0 && abs($results[$i]['final_score'] - $results[$i - 1]['final_score']) < 0.00001) {
                $results[$i]['rank'] = $results[$i - 1]['rank'];
            } else {
                $results[$i]['rank'] = $i + 1;
            }
        }

        return $results;
    }

    /**
     * Agregasi Hasil SAW Menggunakan Metode Borda
     * 
     * Kebijakan Penanganan Seri:
     * Jika terjadi nilai/skor yang seri pada posisi peringkat p sampai p+k-1,
     * poin Borda dari posisi-posisi tersebut dijumlahkan dan dibagi rata (average points sharing).
     * Contoh 3 kandidat (poin posisi 1=3, 2=2, 3=1):
     * - Seri posisi 1 & 2: masing-masing memperoleh (3 + 2)/2 = 2.5 poin.
     * - Seri posisi 2 & 3: masing-masing memperoleh (2 + 1)/2 = 1.5 poin.
     * - Seri seluruhnya 1, 2, 3: masing-masing memperoleh (3 + 2 + 1)/3 = 2.0 poin.
     * 
     * @param array $dmScores Array hasil skor per DM: [dm_id => [candidate_id => final_score, ...], ...]
     * @param array $candidates Daftar kandidat lengkap [['id' => 1, 'name' => 'Kandidat A'], ...]
     * @return array Hasil Borda lengkap dengan poin total, persentase nilai, dan rincian per DM
     */
    public function calculateBorda(array $dmScores, array $candidates): array
    {
        $numCandidates = count($candidates);
        if ($numCandidates < 2) {
            throw new InvalidArgumentException('Minimal terdapat dua kandidat untuk metode Borda.');
        }
        if (empty($dmScores)) {
            throw new InvalidArgumentException('Penilaian decision maker tidak boleh kosong.');
        }

        // Poin dasar Borda: peringkat 1 = N, peringkat 2 = N-1, ..., peringkat N = 1
        $positionPoints = [];
        for ($pos = 1; $pos <= $numCandidates; $pos++) {
            $positionPoints[$pos] = $numCandidates - $pos + 1;
        }

        $candidatePoints = [];
        $dmPointsBreakdown = [];
        foreach ($candidates as $candidate) {
            $candidatePoints[$candidate['id']] = 0.0;
        }

        // Hitung poin per DM
        foreach ($dmScores as $dmId => $scores) {
            // Urutkan kandidat berdasarkan skor DM ini (menurun)
            arsort($scores, SORT_NUMERIC);

            // Kelompokkan kandidat berdasarkan skor untuk mendeteksi seri
            $grouped = [];
            foreach ($scores as $candidateId => $score) {
                $roundedScore = (string)round((float)$score, 4);
                $grouped[$roundedScore][] = (int)$candidateId;
            }

            $currentPos = 1;
            $dmPointsBreakdown[$dmId] = [];

            foreach ($grouped as $scoreKey => $tiedCandidateIds) {
                $tiedCount = count($tiedCandidateIds);
                // Hitung total poin untuk posisi-posisi yang ditempati kelompok seri
                $sumPoints = 0;
                for ($p = $currentPos; $p < $currentPos + $tiedCount; $p++) {
                    $sumPoints += $positionPoints[$p] ?? 1;
                }
                $avgPoint = $sumPoints / $tiedCount;

                foreach ($tiedCandidateIds as $candidateId) {
                    $candidatePoints[$candidateId] += $avgPoint;
                    $dmPointsBreakdown[$dmId][$candidateId] = [
                        'score' => (float)$scoreKey,
                        'rank_position' => $currentPos,
                        'is_tied' => ($tiedCount > 1),
                        'points' => $avgPoint,
                    ];
                }

                $currentPos += $tiedCount;
            }
        }

        $totalAllPoints = array_sum($candidatePoints);
        if ($totalAllPoints <= 0) {
            $totalAllPoints = 1.0;
        }

        $bordaResults = [];
        foreach ($candidates as $candidate) {
            $cId = (int)$candidate['id'];
            $pts = $candidatePoints[$cId] ?? 0.0;
            $bordaValue = ($pts / $totalAllPoints);

            $bordaResults[] = [
                'candidate_id' => $cId,
                'candidate_name' => $candidate['name'] ?? ('Kandidat ' . $cId),
                'borda_points' => round($pts, 4),
                'borda_value' => round($bordaValue, 4),
                'percentage' => round($bordaValue * 100, 2),
            ];
        }

        // Urutkan Borda descending
        usort($bordaResults, function ($a, $b) {
            if (abs($b['borda_points'] - $a['borda_points']) > 0.0001) {
                return $b['borda_points'] <=> $a['borda_points'];
            }
            return $a['candidate_id'] <=> $b['candidate_id'];
        });

        // Set rank Borda
        for ($i = 0; $i < count($bordaResults); $i++) {
            if ($i > 0 && abs($bordaResults[$i]['borda_points'] - $bordaResults[$i - 1]['borda_points']) < 0.0001) {
                $bordaResults[$i]['rank'] = $bordaResults[$i - 1]['rank'];
            } else {
                $bordaResults[$i]['rank'] = $i + 1;
            }
        }

        return [
            'total_points_distributed' => round($totalAllPoints, 2),
            'rankings' => $bordaResults,
            'dm_breakdown' => $dmPointsBreakdown,
        ];
    }

    /**
     * Evaluasi Hasil Voting Langsung Putaran
     * 
     * @param array $votes Map [user_id => candidate_id]
     * @param array $candidates Daftar kandidat lengkap
     * @param int $eligibleCount Jumlah total pemilih yang berhak memberikan suara (default 3 untuk panel DM)
     * @return array Status voting: waiting, majority, atau tie_revote
     */
    public function evaluateVotes(array $votes, array $candidates, int $eligibleCount = 3): array
    {
        $voterIds = array_keys($votes);
        if (count($voterIds) !== count(array_unique($voterIds))) {
            throw new InvalidArgumentException('Setiap pengambil keputusan hanya dapat memberikan satu suara per putaran.');
        }

        $totalVotes = count($votes);
        $candidateMap = [];
        foreach ($candidates as $c) {
            $candidateMap[$c['id']] = $c['name'];
        }

        // Hitung perolehan suara per kandidat
        $counts = [];
        foreach ($candidates as $c) {
            $counts[$c['id']] = 0;
        }
        foreach ($votes as $cId) {
            if (isset($counts[$cId])) {
                $counts[$cId]++;
            }
        }

        // Ambang batas mayoritas (minimal 2/3 dari jumlah pemilih yang berhak)
        $threshold = (int)ceil((2 * $eligibleCount) / 3);

        // Jika belum seluruh pemilih yang berhak memberikan suara
        if ($totalVotes < $eligibleCount) {
            return [
                'status' => 'waiting',
                'is_completed' => false,
                'total_votes_cast' => $totalVotes,
                'required_votes' => $eligibleCount,
                'majority_threshold' => $threshold,
                'eligible_voters' => $eligibleCount,
                'winner' => null,
                'tallies' => $this->formatTallies($counts, $candidateMap, $totalVotes),
            ];
        }

        $maxVotes = max($counts);
        $topCandidates = array_keys(array_filter($counts, fn($cnt) => $cnt === $maxVotes));

        // Jika ada lebih dari 1 peraih suara tertinggi atau perolehan tertinggi kurang dari ambang batas 2/3
        if (count($topCandidates) > 1 || $maxVotes < $threshold) {
            return [
                'status' => 'tie_revote',
                'is_completed' => true,
                'requires_revote' => true,
                'total_votes_cast' => $totalVotes,
                'required_votes' => $eligibleCount,
                'majority_threshold' => $threshold,
                'eligible_voters' => $eligibleCount,
                'winner' => null,
                'tallies' => $this->formatTallies($counts, $candidateMap, $totalVotes),
            ];
        }

        // Tercapai mayoritas sah
        $winnerId = (int)$topCandidates[0];
        $winnerVotes = $counts[$winnerId];
        $percentage = round(($winnerVotes / $totalVotes) * 100, 2);

        return [
            'status' => 'majority',
            'is_completed' => true,
            'requires_revote' => false,
            'total_votes_cast' => $totalVotes,
            'required_votes' => $eligibleCount,
            'majority_threshold' => $threshold,
            'eligible_voters' => $eligibleCount,
            'winner' => [
                'candidate_id' => $winnerId,
                'candidate_name' => $candidateMap[$winnerId] ?? ('Kandidat ' . $winnerId),
                'votes' => $winnerVotes,
                'percentage' => $percentage,
            ],
            'tallies' => $this->formatTallies($counts, $candidateMap, $totalVotes),
        ];
    }

    private function formatTallies(array $counts, array $candidateMap, int $totalVotes): array
    {
        $out = [];
        foreach ($counts as $cId => $cnt) {
            $pct = ($totalVotes > 0) ? round(($cnt / $totalVotes) * 100, 2) : 0.0;
            $out[] = [
                'candidate_id' => $cId,
                'candidate_name' => $candidateMap[$cId] ?? ('Kandidat ' . $cId),
                'votes' => $cnt,
                'percentage' => $pct,
            ];
        }
        return $out;
    }
}
