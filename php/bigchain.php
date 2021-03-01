<?php
  
/**
 * This page extends the functionality of bigbed.php to operate on bigChain files
 * (along with the bigLink files, provided at `link_url`)
 * bigBedSummary and bigBedToBed must be at ../bin/
 **/
require_once('../lib/setup.php');

if (!validate_URL_in_GET_param('link_url', TRUE)) { forbidden(); }
passthru_basic_auth_for_GET_param('link_url');

// Run all of the same logic and functionality at the bigbed.php endpoint
include('bigbed.php');

if (!$INFO_ONLY && $SEARCH === FALSE && !$SUMMARY) {
  // If we are fetching only raw BED data, also provide data for the $ranges in the bigLink file, delimited by a double newline
  echo "\n";
  $out = shell_exec("$BIGBED_BIN " . escapeshellarg($_GET['link_url']) . " " . implode(" ", array_map('escapeshellarg', $range)) . $cmd_suffix);
  echo $out;
}