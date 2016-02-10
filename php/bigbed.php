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

function valid_range($range) { return preg_match(RANGE_PATTERN, $range)===1; }

$INFO_ONLY = FALSE;

if (!isset($_GET['url']) || !preg_match('#^(https?|cache)://#', $_GET['url'])) { bad_request(); }
$_GET['url'] = preg_replace('#^cache://#', dirname(dirname(__FILE__)) . "/", $_GET['url']);
if (!isset($_GET['range'])) { $INFO_ONLY = TRUE; } 
else { $ranges = array_filter((array) $_GET['range'], 'valid_range'); }
if (isset($_GET['range']) && !count($ranges)) { bad_request(); }
$SUMMARY = isset($_GET['density']) && $_GET['density']=='dense';
if ($SUMMARY) {
  if (!isset($_GET['width'])) { bad_request(); }
  $WIDTH = max(min(intval($_GET['width']), 5000), 1);
}

$BIGBED_BIN = escapeshellarg(dirname(dirname(__FILE__)) . '/bin/bigBed' . ($INFO_ONLY ? 'Info' : ($SUMMARY ? 'Summary' : 'ToBed')));

function ranges_to_args(&$ranges) {
  global $SUMMARY, $WIDTH;
  $total_bps = 0;
  foreach($ranges as &$range) {
    $matches = array();
    preg_match(RANGE_PATTERN, $range, $matches);
    array_shift($matches);
    if (!$SUMMARY) {
      // bigBedSummary doesn't use flagged options for the range; bigBedToBed does.
      $matches[0] = "-chrom={$matches[0]}";
      $matches[1] = "-start={$matches[1]}";
      $matches[2] = "-end={$matches[2]}";
    } else { $total_bps += intval($matches[2]) - intval($matches[1]); }
    $range = $matches;
  }
  if ($SUMMARY) foreach($ranges as &$range) {
    $range[3] = round((intval($range[2]) - intval($range[1])) / $total_bps * $WIDTH);
  }
}

if ($INFO_ONLY) {
  // Without the range and density parameters, return a JSON document containing info about the bigBed
  header('Content-type: application/json');
  $BOOL_VALS = array('yes'=> TRUE, 'no' => FALSE);
  
  exec("$BIGBED_BIN " . escapeshellarg($_GET['url']) . ' 2>&1', $output, $retval);
  if ($retval) { echo json_encode(array("error" => $output)); }
  else {
    $info = array();
    foreach ($output as $line) { 
      $parts = explode(':', $line, 2);
      $val = isset($BOOL_VALS[$parts[1]]) ? $BOOL_VALS[$parts[1]] : floatval(preg_replace('/[, ]/', '', $parts[1]));
      $info[preg_replace('/^(\w+)\W.*/', '$1', $parts[0])] = $val;
    }
    echo json_encode($info);
  }
} else {
  // With range and density parameters, return either a summary of datapoints or the raw BED rows themselves
  header('Content-type: text/plain');
  
  ranges_to_args($ranges);
  foreach ($ranges as $range) {
    $CMD_SUFFIX = $SUMMARY ? ' 2>&1' : ' /dev/stdout';
    $out = shell_exec("$BIGBED_BIN " . escapeshellarg($_GET['url']) . " " . implode(" ", array_map('escapeshellarg', $range)) . $CMD_SUFFIX);
    if ($SUMMARY && preg_match('/^no data in region|^needLargeMem/', $out)) {
      echo str_repeat("n/a\t", $range[3]);
    } else {
      echo $out;
    }
  }
}
