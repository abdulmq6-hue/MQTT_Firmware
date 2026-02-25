const pdf = require('pdf-parse');

/**
 * DIP Chart Parser for ATG Systems
 * Parses calibration/strapping tables from PDF files
 * Supports multiple formats:
 * - Format A: 4-column concatenated (MM_Litres_final.pdf) - 10mm increments
 * - Format B: Split numbers (SHIREEN HSD DIP CHART.pdf) - 1mm increments
 */

// Configuration for validation
const CONFIG = {
    maxDepth: 3000,      // Maximum depth in mm
    maxVolume: 55000,    // Maximum volume in liters
};

async function parseDipChart(buffer) {
    try {
        const data = await pdf(buffer);
        const text = data.text;

        console.log('Parsing DIP chart PDF...');
        console.log('Number of pages:', data.numpages);

        const numbers = text.match(/\d+/g) || [];
        console.log('Total numbers found:', numbers.length);

        // Try all parsing methods and use the one that extracts the most valid entries
        const results = [];

        // Method 1: 4-column concatenated format (for PDFs like MM_Litres_final.pdf)
        const concatenatedRows = text.match(/\d{15,}/g) || [];
        if (concatenatedRows.length > 0) {
            console.log(`Found ${concatenatedRows.length} concatenated rows`);
            const concatPairs = parseConcatenatedFormat(text, concatenatedRows);
            console.log(`Concatenated format parsing found ${concatPairs.length} entries`);
            results.push({ method: 'concatenated', pairs: concatPairs });
        }

        // Method 2: Split numbers format (for PDFs like SHIREEN HSD DIP CHART.pdf)
        const splitPairs = parseSplitNumbers(numbers);
        console.log(`Split format parsing found ${splitPairs.length} entries`);
        results.push({ method: 'split', pairs: splitPairs });

        // Method 3: Paired numbers (consecutive pairs)
        const pairedPairs = parsePairedNumbers(numbers);
        console.log(`Paired format parsing found ${pairedPairs.length} entries`);
        results.push({ method: 'paired', pairs: pairedPairs });

        // Select the method that found the most entries
        results.sort((a, b) => b.pairs.length - a.pairs.length);
        const best = results[0];
        console.log(`Using ${best.method} method with ${best.pairs.length} entries`);

        const pairs = best.pairs;

        console.log(`Final result: ${pairs.length} depth-volume pairs`);

        if (pairs.length > 0) {
            console.log(`Depth range: ${pairs[0].depth} - ${pairs[pairs.length - 1].depth} mm`);
            console.log(`Volume range: ${pairs[0].volume} - ${pairs[pairs.length - 1].volume} L`);
        }

        return pairs;
    } catch (err) {
        console.error("Error parsing PDF:", err);
        throw err;
    }
}

/**
 * Parse 4-column concatenated format (MM_Litres_final.pdf style)
 * Rows look like: "0735034087009254105016252"
 */
function parseConcatenatedFormat(text, concatenatedRows) {
    const pairsMap = new Map();

    // Define the column structure for typical DIP charts
    // Page 1: columns start at 0, 350, 700, 1050 (35 rows: 0-340, 350-690, 700-1040, 1050-1390)
    // Page 2: columns start at 1400, 1750, 2100, 2450 (35 rows)
    // Page 3: remaining data (2800-2890)

    const columnBases = [
        [0, 350, 700, 1050],      // Page 1
        [1400, 1750, 2100, 2450], // Page 2
        [2800, 0, 0, 0]           // Page 3 (only first column has data)
    ];

    let rowIndex = 0;
    for (const rowStr of concatenatedRows) {
        // Determine which page/column set this row belongs to
        let pageIndex = Math.floor(rowIndex / 35);
        let localRow = rowIndex % 35;

        if (pageIndex >= columnBases.length) pageIndex = columnBases.length - 1;

        const bases = columnBases[pageIndex];
        const expectedDepths = bases.map(base => base > 0 || bases[0] === 0 ? base + localRow * 10 : -1).filter(d => d >= 0 && d <= CONFIG.maxDepth);

        // Parse this row using expected depths
        const rowPairs = parseRowWithExpectedDepths(rowStr, expectedDepths);
        for (const { depth, volume } of rowPairs) {
            if (!pairsMap.has(depth)) {
                pairsMap.set(depth, volume);
            }
        }

        rowIndex++;
    }

    // Also handle page 3 single-column data (shorter strings like "280049523")
    // These are 9-digit strings: 4-digit depth + 5-digit volume
    const page3Rows = text.match(/\b(28[0-9]\d)(\d{5})\b/g) || [];
    for (const rowStr of page3Rows) {
        const depth = parseInt(rowStr.substring(0, 4), 10);
        const volume = parseInt(rowStr.substring(4), 10);

        if (depth >= 2800 && depth <= CONFIG.maxDepth && volume > 0 && volume <= CONFIG.maxVolume) {
            if (!pairsMap.has(depth)) {
                pairsMap.set(depth, volume);
            }
        }
    }

    // Convert to sorted array
    const pairs = Array.from(pairsMap.entries())
        .map(([depth, volume]) => ({ depth, volume }))
        .sort((a, b) => a.depth - b.depth);

    return filterMonotonic(pairs);
}

/**
 * Parse a concatenated row string using known expected depth values
 * Example: "0735034087009254105016252" with depths [0, 350, 700, 1050]
 * Returns: [{depth:0, volume:7}, {depth:350, volume:3408}, ...]
 */
function parseRowWithExpectedDepths(rowStr, expectedDepths) {
    const pairs = [];
    let remaining = rowStr;

    for (let i = 0; i < expectedDepths.length; i++) {
        const depth = expectedDepths[i];
        const depthStr = depth.toString();

        // The row should start with this depth
        if (!remaining.startsWith(depthStr)) {
            // Try to find the depth in the remaining string
            const idx = remaining.indexOf(depthStr);
            if (idx === -1) continue;
            remaining = remaining.substring(idx);
        }

        // Remove the depth from the start
        remaining = remaining.substring(depthStr.length);

        // Now extract the volume - it's everything until the next depth (or end of string)
        let volumeStr = '';
        const nextDepth = i + 1 < expectedDepths.length ? expectedDepths[i + 1] : null;

        if (nextDepth !== null) {
            const nextDepthStr = nextDepth.toString();
            // Find where the next depth starts
            // We need to be careful: volume might contain digits that look like the next depth
            // So we look for the next depth at a position that makes sense

            // Find the position where nextDepthStr appears
            const nextIdx = findNextDepthPosition(remaining, nextDepthStr);
            if (nextIdx > 0) {
                volumeStr = remaining.substring(0, nextIdx);
                remaining = remaining.substring(nextIdx);
            } else {
                // Next depth not found, take reasonable volume length
                volumeStr = remaining.substring(0, Math.min(5, remaining.length));
                remaining = remaining.substring(volumeStr.length);
            }
        } else {
            // Last column - take the rest
            volumeStr = remaining;
            remaining = '';
        }

        const volume = parseInt(volumeStr, 10);
        if (!isNaN(volume) && volume > 0 && volume <= CONFIG.maxVolume) {
            pairs.push({ depth, volume });
        }
    }

    return pairs;
}

/**
 * Find the position where the next depth string starts
 * This handles cases where volume digits might match the depth pattern
 */
function findNextDepthPosition(str, depthStr) {
    // Simple approach: find the first occurrence
    const idx = str.indexOf(depthStr);
    if (idx <= 0) return idx;

    // Make sure we have enough chars before for a reasonable volume (at least 1 digit)
    if (idx >= 1) {
        return idx;
    }

    return -1;
}

/**
 * Parse consecutive number pairs as (depth, volume)
 * This handles tabular PDF formats where MM and LITERS are separate columns
 */
function parsePairedNumbers(numbers) {
    const pairsMap = new Map();

    // Process numbers in pairs: [depth1, volume1, depth2, volume2, ...]
    for (let i = 0; i < numbers.length - 1; i++) {
        const depth = parseInt(numbers[i], 10);
        const volume = parseInt(numbers[i + 1], 10);

        if (isNaN(depth) || isNaN(volume)) continue;

        // Validate ranges
        if (depth < 0 || depth > CONFIG.maxDepth) continue;
        if (volume < 0 || volume > CONFIG.maxVolume) continue;

        // Volume should generally be positive and reasonable
        if (volume <= 0) continue;

        // Store in map, keeping higher volume if duplicate depth
        if (!pairsMap.has(depth) || pairsMap.get(depth) < volume) {
            pairsMap.set(depth, volume);
        }
    }

    // Convert to sorted array
    const pairs = Array.from(pairsMap.entries())
        .map(([depth, volume]) => ({ depth, volume }))
        .sort((a, b) => a.depth - b.depth);

    // Filter for monotonically increasing volumes
    return filterMonotonic(pairs);
}

/**
 * Parse by splitting concatenated numbers (for SHIREEN format with 1mm increments)
 * Numbers like "06", "17", "28", "1121" represent depth-volume pairs
 * Pattern: 06->d=0,v=6 | 1121->d=11,v=21 | 100516->d=100,v=516
 */
function parseSplitNumbers(numbers) {
    const pairsMap = new Map();

    for (const numStr of numbers) {
        if (numStr.length < 2) continue;

        // Find the best split for this number
        const bestCandidate = findBestSplit(numStr);

        if (bestCandidate) {
            const { depth, volume } = bestCandidate;

            if (!pairsMap.has(depth)) {
                pairsMap.set(depth, volume);
            } else {
                const existing = pairsMap.get(depth);
                // Keep the value with better volume/depth ratio
                const existingRatio = existing / (depth || 1);
                const newRatio = volume / (depth || 1);
                // For tank calibration, ratio typically 1-30 depending on tank shape
                const idealRatio = 15;
                if (Math.abs(newRatio - idealRatio) < Math.abs(existingRatio - idealRatio)) {
                    pairsMap.set(depth, volume);
                }
            }
        }
    }

    const pairs = Array.from(pairsMap.entries())
        .map(([depth, volume]) => ({ depth, volume }))
        .sort((a, b) => a.depth - b.depth);

    return filterMonotonic(pairs);
}

/**
 * Find the best way to split a number into depth-volume
 * Based on expected ratio: volume should be ~1-30x depth for typical tanks
 */
function findBestSplit(numStr) {
    const len = numStr.length;
    let bestCandidate = null;
    let bestScore = Infinity;

    // Try different split positions (depth can be 1-4 digits)
    for (let splitPos = 1; splitPos <= Math.min(4, len - 1); splitPos++) {
        const depthStr = numStr.substring(0, splitPos);
        const volumeStr = numStr.substring(splitPos);

        // Skip if volume has leading zeros (except single digit)
        if (volumeStr.length > 1 && volumeStr.startsWith('0')) continue;

        const depth = parseInt(depthStr, 10);
        const volume = parseInt(volumeStr, 10);

        if (isNaN(depth) || isNaN(volume)) continue;
        if (depth < 0 || depth > CONFIG.maxDepth) continue;
        if (volume <= 0 || volume > CONFIG.maxVolume) continue;

        // For very small depths (0-5), volume should be small too (5-20 range)
        if (depth <= 5 && (volume < 5 || volume > 50)) continue;

        // For depth 6-20, volume should be reasonable
        if (depth > 5 && depth <= 20 && volume > depth * 10) continue;

        // Calculate ratio score - ideal ratio for tank is roughly 5-20
        const ratio = volume / (depth || 1);

        // Skip extreme ratios
        if (depth > 10 && (ratio < 0.5 || ratio > 100)) continue;

        // Score based on how close ratio is to expected range (5-20)
        let score;
        if (ratio >= 1 && ratio <= 30) {
            score = Math.abs(ratio - 10); // Prefer ratio around 10
        } else {
            score = 1000 + Math.abs(ratio - 10); // Penalize far-off ratios
        }

        if (score < bestScore) {
            bestScore = score;
            bestCandidate = { depth, volume };
        }
    }

    return bestCandidate;
}

/**
 * Try all possible ways to split a number into depth and volume
 */
function tryAllSplits(numStr) {
    const candidates = [];
    const len = numStr.length;

    for (let splitPos = 1; splitPos <= Math.min(4, len - 1); splitPos++) {
        const depthStr = numStr.substring(0, splitPos);
        const volumeStr = numStr.substring(splitPos);

        if (volumeStr.length > 1 && volumeStr.startsWith('0')) continue;

        const depth = parseInt(depthStr, 10);
        const volume = parseInt(volumeStr, 10);

        if (!isNaN(depth) && !isNaN(volume) && volume > 0) {
            candidates.push({ depth, volume });
        }
    }

    return candidates;
}

/**
 * Filter pairs to ensure monotonically increasing volumes with reasonable progression
 */
function filterMonotonic(pairs) {
    if (pairs.length === 0) return [];

    const result = [];
    let lastVol = -1;
    let lastDepth = -1;

    for (const p of pairs) {
        // Volume must increase with depth
        if (p.volume <= lastVol) continue;

        // Check for reasonable volume progression
        // Volume shouldn't jump too much between consecutive entries
        if (lastVol > 0 && lastDepth >= 0) {
            const depthGap = p.depth - lastDepth;
            const volumeJump = p.volume - lastVol;
            const avgIncrease = volumeJump / depthGap;

            // For 1mm increment format (SHIREEN): avg increase should be < 15 L/mm
            // For 10mm increment format (MM_Litres): avg increase should be < 25 L/mm
            // Use a threshold that works for both: 30 L/mm max
            if (avgIncrease > 30) continue;

            // Additional check for small gaps with large absolute jumps
            // (catches header garbage like depth=11, volume=78 when last was depth=10, volume=19)
            // But allow larger jumps for bigger tanks/depths
            const maxJump = Math.max(100, lastVol * 0.5); // Allow up to 50% increase or 100L minimum
            if (depthGap <= 5 && volumeJump > maxJump) continue;
        }

        result.push(p);
        lastVol = p.volume;
        lastDepth = p.depth;
    }

    return result;
}

module.exports = { parseDipChart };
