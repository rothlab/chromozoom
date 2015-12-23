<?php
/**
 * This page passes off a URL to a BAM file and a series of positions to `samtools view`.
 * Symlink samtools into the ../bin directory.
 **/
function bad_request() {
  header('HTTP/1.1 403 Forbidden');
  exit;
}

define('RANGE_PATTERN', '/^(\\w+[^:]+):(\\d+)-(\\d+)$/');

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

$SAMTOOLS = escapeshellarg(dirname(dirname(__FILE__)) . '/bin/samtools') . ' ' . ($INFO_ONLY ? 'idxstats' : 'view');

$tmp_dir = '/tmp/samtools-' . substr(strtr(base64_encode(sha1(dirname($_GET['url']), TRUE)), '/', '-'), 0, 12);
while (file_exists($tmp_dir) && !is_dir($tmp_dir)) { $tmp_dir .= '+'; } 
if (!file_exists($tmp_dir)) { mkdir($tmp_dir); }
chmod($tmp_dir, 0755);
chdir($tmp_dir);

//TODO: For the `dense` density, we can plot a wiggle of the coverage, using `samtools bedcov`
// cat regions.bed | samtools bedcov /dev/stdin path.to.bam
// Although this is quite slow. It might be worth trying to convert the output of `samtools depth` to .bigwig
// The following spits out bedGraph, minus the third column, which should just be the second column + 1
// samtools depth [-r chrX:1-20000] path.to.bam 
// This could be shooped into bigWig with bedGraphToBigWig if the third column is added back with awk...
// samtools depth [-r chrX:1-20000] path.to.bam | awk -F "\t" 'BEGIN {OFS = FS} {$4 = $3; $3 = $2; $2 = $2 - 1; print}' > out.bedgraph

header('Content-type: text/plain');
passthru("$SAMTOOLS " . escapeshellarg($_GET['url']) . " " . implode(' ', array_map('escapeshellarg', $ranges)));