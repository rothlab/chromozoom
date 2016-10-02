<?php
/**
 * This page fetches a genomic range from a bigWig file available at a URL
 * bigWigSummary and bigWigInfo must be at ../bin/
 **/
require_once('../lib/setup.php');

function bad_request() {
  header('HTTP/1.1 403 Forbidden');
  exit;
}

define('RANGE_PATTERN', '/^(\\w+[^:]*):(\\d+)-(\\d+)$/');
$WINFUNCS = array('minimum'=>'min', 'maximum'=>'max', 'mean'=>'mean', 'min'=>'min', 'max'=>'max', 
  'std'=>'std', 'coverage'=>'coverage');
define('TOO_FEW_PIXELS', 3); // Not worth calling bigWigSummary for this small of an output range

function valid_range($range) { return preg_match(RANGE_PATTERN, $range)===1; }
 
if (!validate_URL_in_GET_param('url', FALSE)) { bad_request(); }
passthru_basic_auth_for_GET_param('url');
$SUMMARY = !isset($_GET['info']);
if ($SUMMARY) {
  if (!isset($_GET['range'])) { bad_request(); } 
  else { $ranges = array_filter((array) $_GET['range'], 'valid_range'); }
  if (!count($ranges)) { bad_request(); }
  if (!isset($_GET['width'])) { bad_request(); }
  $WIDTH = max(min(intval($_GET['width']), 5000), 1);
  if (!isset($_GET['winFunc']) || !isset($WINFUNCS[strtolower($_GET['winFunc'])])) { bad_request(); }
  $WINFUNC = "-type=" . $WINFUNCS[strtolower($_GET['winFunc'])];
}

$BIGWIG_BIN = escapeshellarg(dirname(dirname(__FILE__)) . '/bin/bigWig' . ($SUMMARY ? 'Summary' : 'Info'));

function ranges_to_args(&$ranges) {
  global $SUMMARY, $WIDTH;
  $total_bps = 0;
  foreach($ranges as &$range) {
    $matches = array();
    preg_match(RANGE_PATTERN, $range, $matches);
    array_shift($matches);
    $total_bps += intval($matches[2]) - intval($matches[1]);
    $range = $matches;
  }
  $cumulative_bps = 0;
  $cumulative_pixels = 0;
  if ($SUMMARY) foreach($ranges as &$range) {
    // Number of summary values to request for this range, which we try to align to the nearest cumulative pixel
    $bp_width = intval($range[2]) - intval($range[1]);
    $range[3] = max(round((($cumulative_bps + $bp_width) / $total_bps * $WIDTH) - $cumulative_pixels), 0);
    $cumulative_bps += $bp_width;
    $cumulative_pixels += $range[3];
  }
}

header('Content-type: text/plain');
if ($SUMMARY) {
  ranges_to_args($ranges);
  header('X-Cmd: ' . "$BIGWIG_BIN $WINFUNC " . escapeshellarg($_GET['url']) . " " . implode(" ", array_map('escapeshellarg', $ranges[0])));  
  foreach ($ranges as $range) {
    if ($range[3] <= 0) { continue; }
    if ($range[3] <= TOO_FEW_PIXELS) { echo implode("\t", array_fill(0, $range[3], "n/a")) . "\n"; continue; }
    $cmd = "$BIGWIG_BIN $WINFUNC " . escapeshellarg($_GET['url']) . " " . implode(" ", array_map('escapeshellarg', $range));
    $output = array();
    exec($cmd, $output, $retval);
    if ($retval) { echo implode("\t", array_fill(0, $range[3], "n/a")) . "\n"; }
    else { echo implode("\n", $output) . "\n"; }
  }
} else {
  passthru("$BIGWIG_BIN " . escapeshellarg($_GET['url']));
}