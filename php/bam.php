<?php
/**
 * This page passes off a URL to a BAM file and a series of positions to `samtools view`.
 * Symlink samtools into the ../bin directory.
 **/
require_once('../lib/setup.php');
require_once('../lib/autoconvert_chrs.php');

define('RANGE_PATTERN', '/^(\\w+[^:]*):(\\d+)-(\\d+)$/');

function valid_range($range) { return preg_match(RANGE_PATTERN, $range)===1; }

$ranges = array();
$INFO_ONLY = FALSE;

if (!validate_URL_in_GET_param('url', FALSE)) { forbidden(); }
passthru_basic_auth_for_GET_param('url');
if (isset($_GET['info'])) { $INFO_ONLY = TRUE; } 
$ranges = array_filter((array) $_GET['range'], 'valid_range');
if (!isset($_GET['range']) || !count($ranges)) { forbidden(); }

// currently unused; bam.js does all summary statistics on its end. See below NOTE for some more thoughts on this
//
// $SUMMARY = isset($_GET['density']) && $_GET['density']=='dense';
// if ($SUMMARY) {
//   if (!isset($_GET['width'])) { forbidden(); }
//   $WIDTH = max(min(intval($_GET['width']), 5000), 1);
// }

$SAMTOOLS = escapeshellarg(dirname(dirname(__FILE__)) . '/bin/samtools') . ' view';
$SAMTOOLS_INFO = escapeshellarg(dirname(dirname(__FILE__)) . '/bin/samtools') . ' idxstats';

$tmp_dir = '/tmp/samtools-' . substr(strtr(base64_encode(sha1(dirname($_GET['url']), TRUE)), '/', '-'), 0, 12);
while (file_exists($tmp_dir) && !is_dir($tmp_dir)) { $tmp_dir .= '+'; } 
if (!file_exists($tmp_dir)) { mkdir($tmp_dir); }
chmod($tmp_dir, 0755);
chdir($tmp_dir);

// NOTE: For the `dense` density, we could simply plot a wiggle of the coverage, using `samtools bedcov`
//     cat regions.bed | samtools bedcov /dev/stdin path.to.bam
// Although this is quite slow. It might be worth trying to convert the output of `samtools depth` to .bigwig
// The following spits out bedGraph, minus the third column, which should just be the second column + 1
//     samtools depth [-r chrX:1-20000] path.to.bam 
// This could be shooped into bigWig with bedGraphToBigWig if the third column is added back with awk...
//     samtools depth [-r chrX:1-20000] path.to.bam | \
//         awk -F "\t" 'BEGIN {OFS = FS} {$4 = $3; $3 = $2; $2 = $2 - 1; print}' > out.bedgraph
// Of course, all of this would have to be done in the background *after* a BAM is loaded and would be
// caching a lot of data the user may not want to see.
// It's possible to take the IGV approach and tell the user to specially request this or do it themselves if they really care.

header('Content-type: text/plain');

if ($INFO_ONLY) {
  // First we fetch and echo the output of samtools idxstats, which has info on allowed RNAME's and their density.
  $output = array();
  exec("$SAMTOOLS_INFO " . escapeshellarg($_GET['url']), $output, $retval);
  autoconvert_chrs($ranges, $output);
  echo implode("\n", $output) . "\n\n";
  $ranges = implode(' ', array_map('escapeshellarg', $ranges));
  // Now get the first 500 reads from the given range for the purposes of read length and insert size statistics.
  // We eliminate non-primary and unmapped reads with the -F and -f flags. We also dispense with the SEQ and QUAL columns.
  //     samtools view -F3852 -f2 http://url/to/file.bam $range 2>/dev/null | head -n 100 | cut -f1-9
  passthru("$SAMTOOLS -F3852 " . escapeshellarg($_GET['url']) . " $ranges 2>/dev/null | head -n 500 | cut -f1-9");
} else {
  $ranges = implode(' ', array_map('escapeshellarg', $ranges));
  passthru("$SAMTOOLS " . escapeshellarg($_GET['url']) . " $ranges");
}
