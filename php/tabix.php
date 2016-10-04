<?php
/**
 * This page runs a URL to a tabix-indexed file and a series of positions through tabix.
 * Symlink tabix to the ../bin directory
 **/
require_once('../lib/setup.php');
require_once('../lib/autoconvert_chrs.php');

define('RANGE_PATTERN', '/^(\\w+[^:]*):(\\d+)-(\\d+)$/');

function valid_range($range) { return preg_match(RANGE_PATTERN, $range)===1; }
 
$INFO_ONLY = FALSE;
$NUM_FIELDS = 3;
 
if (!validate_URL_in_GET_param('url', FALSE)) { forbidden(); }
passthru_basic_auth_for_GET_param('url');
if (!($tmp_dir = ensure_tmp_dir_exists())) { forbidden(); }

if (isset($_GET['info'])) { 
  $INFO_ONLY = TRUE;
  if (preg_match('#^\\d+$#', $_GET['info'])) { $NUM_FIELDS = min(max(intval($_GET['info']), 3), 12); }
}
$ranges = array_filter((array) $_GET['range'], 'valid_range');
if (!isset($_GET['range']) || !count($ranges)) { forbidden(); }

$TABIX = escapeshellarg(dirname(dirname(__FILE__)) . '/bin/tabix');

$tmp_dir .= '/tabix-' . substr(strtr(base64_encode(sha1(dirname($_GET['url']), TRUE)), '/', '-'), 0, 12);
while (file_exists($tmp_dir) && !is_dir($tmp_dir)) { $tmp_dir .= '+'; } 
if (!file_exists($tmp_dir)) { mkdir($tmp_dir); }
chmod($tmp_dir, 0755);
chdir($tmp_dir);
header('Content-type: text/plain');

if ($INFO_ONLY) {
  // First we fetch and echo the output of tabix -l, which has info on allowed contig names.
  $output = array();
  exec("$TABIX -l " . escapeshellarg($_GET['url']), $output, $retval);
  autoconvert_chrs($ranges, $output);
  echo implode("\n", $output) . "\n\n";
  $ranges = implode(' ', array_map('escapeshellarg', $ranges));
  // Now get the first 500 items from the given range for the purposes of getting some summary statistics
  //     tabix http://url/to/file.vcf.gz $range 2>/dev/null | head -n 500 | cut -f1-9
  passthru("$TABIX " . escapeshellarg($_GET['url']) . " $ranges 2>/dev/null | head -n 500 | cut -f1-$NUM_FIELDS");  
} else {
  passthru("$TABIX " . escapeshellarg($_GET['url']) . " " . implode(' ', array_map('escapeshellarg', $ranges)));  
}
