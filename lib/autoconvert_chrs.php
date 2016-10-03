<?php

// Attempt to automatically remedy RNAME (contig name) mismatches because of UCSC/Ensembl differences.
// This is for the process of getting info on a BAM or tabix file.
// It occurs *before* the CustomTrack JavaScript implementation figures out whether conversion is necessary,
// otherwise we could just use conversion within JavaScript for this purpose.

function first_column($line) { return reset(explode("\t", $line)); }
function autoconvert_chrs(&$ranges, $output) {
  $chrs = array_fill_keys(array_map('first_column', $output), true);
  foreach ($ranges as $i => $range) {
    $range_parts = explode(':', $range);
    $chr = $range_parts[0];
    if (!isset($chrs[$chr])) { 
      $ranges[$i] = (strpos($chr, "chr") === 0 ? substr($chr, 3) : "chr{$chr}") . ":{$range_parts[1]}";
    }
  }
}