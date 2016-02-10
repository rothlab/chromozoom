<?php
/**
 * This page fetches a genomic range from a bigBed file available at a URL
 * bigBedSummary and bigBedToBed must be at ../bin/
 **/
function bad_request() {
  header('HTTP/1.1 403 Forbidden');
  exit;
}

define('RANGE_PATTERN', '/^(\\w+[^:]*):(\\d+)-(\\d+)$/');
$WINFUNCS = array('minimum'=>'min', 'maximum'=>'max', 'mean'=>'mean', 'min'=>'min', 'max'=>'max', 
  'std'=>'std', 'coverage'=>'coverage');

function valid_range($range) { return preg_match(RANGE_PATTERN, $range)===1; }
 
if (!isset($_GET['url']) || !preg_match('#^https?://#', $_GET['url'])) { bad_request(); }
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
  if ($SUMMARY) foreach($ranges as &$range) {
    $range[3] = round((intval($range[2]) - intval($range[1])) / $total_bps * $WIDTH);
  }
}

header('Content-type: text/plain');
if ($SUMMARY) {
  ranges_to_args($ranges);
  foreach ($ranges as $range) {
    $cmd = "$BIGWIG_BIN $WINFUNC " . escapeshellarg($_GET['url']) . " " . implode(" ", array_map('escapeshellarg', $range));
    exec($cmd, $output, $retval);
    if ($retval) { echo implode("\t", array_fill(0, $range[3], "n/a")) . "\n"; }
    else { echo implode("\n", $output); }
  }
} else {
  passthru("$BIGWIG_BIN " . escapeshellarg($_GET['url']));
}