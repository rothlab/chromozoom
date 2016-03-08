<?php
/**
 * This page passes off a URL to a BAM file and a series of positions to `samtools view`.
 * Symlink samtools into the ../bin directory.
 **/
function bad_request() {
  header('HTTP/1.1 403 Forbidden');
  exit;
}

define('RANGE_PATTERN', '/^(\\w+[^:]*):(\\d+)-(\\d+)$/');

function valid_range($range) { return preg_match(RANGE_PATTERN, $range)===1; }

$ranges = array();
$INFO_ONLY = FALSE;

if (!isset($_GET['url']) || !preg_match('#^https?://#', $_GET['url'])) { bad_request(); }
if (!isset($_GET['range'])) { $INFO_ONLY = TRUE; } 
else { $ranges = array_filter((array) $_GET['range'], 'valid_range'); }
if (isset($_GET['range']) && !count($ranges)) { bad_request(); }
$SUMMARY = isset($_GET['density']) && $_GET['density']=='dense';
if ($SUMMARY) {
  if (!isset($_GET['width'])) { bad_request(); }
  $WIDTH = max(min(intval($_GET['width']), 5000), 1);
}

$SAMTOOLS = escapeshellarg(dirname(dirname(__FILE__)) . '/bin/samtools') . ' view';
$SAMTOOLS_INFO = escapeshellarg(dirname(dirname(__FILE__)) . '/bin/samtools') . ' idxstats';

$tmp_dir = '/tmp/samtools-' . substr(strtr(base64_encode(sha1(dirname($_GET['url']), TRUE)), '/', '-'), 0, 12);
while (file_exists($tmp_dir) && !is_dir($tmp_dir)) { $tmp_dir .= '+'; } 
if (!file_exists($tmp_dir)) { mkdir($tmp_dir); }
chmod($tmp_dir, 0755);
chdir($tmp_dir);

// Note: For the `dense` density, we could simply plot a wiggle of the coverage, using `samtools bedcov`
// cat regions.bed | samtools bedcov /dev/stdin path.to.bam
// Although this is quite slow. It might be worth trying to convert the output of `samtools depth` to .bigwig
// The following spits out bedGraph, minus the third column, which should just be the second column + 1
// samtools depth [-r chrX:1-20000] path.to.bam 
// This could be shooped into bigWig with bedGraphToBigWig if the third column is added back with awk...
// samtools depth [-r chrX:1-20000] path.to.bam | awk -F "\t" 'BEGIN {OFS = FS} {$4 = $3; $3 = $2; $2 = $2 - 1; print}' > out.bedgraph
// Of course, all of this would have to be done in the background *after* a BAM is loaded and would be
// caching a lot of data the user may not want to see.
// It's possible to take the IGV approach and tell the user to specially request this or do it themselves if they really care.

header('Content-type: text/plain');

if ($INFO_ONLY) {
  // This gets the first 100 reads, which we can do read length and insert size statistics on
  // `samtools view https://pakt01.u.hpc.mssm.edu/BSR6402-15-17.final.bam 2>/dev/null | head -n 100`
  // More stringently, we can eliminate non-primary and unmapped reads like so:
  // `samtools view -F3852 -f2 https://pakt01.u.hpc.mssm.edu/BSR6402-15-17.final.bam 2>/dev/null | head -n 100 | cut -f1-9`
  passthru("$SAMTOOLS_INFO " . escapeshellarg($_GET['url']) . " " . implode(' ', array_map('escapeshellarg', $ranges)));
  echo "\n";
  passthru("$SAMTOOLS -F3852 -f2 " . escapeshellarg($_GET['url']) . " 2>/dev/null | head -n 100 | cut -f1-9");
} else {
  passthru("$SAMTOOLS " . escapeshellarg($_GET['url']) . " " . implode(' ', array_map('escapeshellarg', $ranges)));
}
