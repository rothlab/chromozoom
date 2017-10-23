<?php
/**
 * This page proxies an HTTP request so that genobrowser can fetch tracks via AJAX.
 *
 * To prevent abuse, it only performs GET requests and if a content-type header is fetched,
 * it has to contain "text/plain".  Also, the first line that does not start with # (used for comments)
 * must start with "browser" or "track" or the first part of a GenBank, EMBL, or FASTA file.
 * This restricts usage of this proxy to just textual data that looks like a valid UCSC custom track file or
 * a GenBank, EMBL, or FASTA file, which will (hopefully) curb any desire to use it illicitly.
 **/
require_once("../lib/setup.php");
require_once("../lib/proxy.php");

// Echoes a barebones track definition line that points to a big format file
// (e.g., if the user actually selected a URL for a bigWig file).
function bigformat_track_def($url, $type) {
  $name = str_replace('"', '', basename($url));
  $url = str_replace('"', '%22', $url);
  echo "track name=\"$name\" type=\"$type\" bigDataUrl=\"$url\"\n";
  exit;
}

// Can whitelist/blacklist content type headers
function valid_content_type($content_type) {
  if ($content_type === NULL) { return true; }  // allow unknown/unspecified to pass
  return preg_match('#text/plain|vnd.realvnc.bed#', $content_type)===1;
}

if (!validate_URL_in_GET_param('url', FALSE)) { forbidden(); }

// First check if this is actually a bigBed or bigWig file
// If the corresponding tool returns a exit code of 0, we guess that it is, and proxy back
// a barebones track definition line with a bigDataUrl equal to this URL.
$FORMAT_BINS = array(
  "bigbed" => escapeshellarg(BASEDIR . '/bin/bigBedInfo'),
  "bigwig" => escapeshellarg(BASEDIR . '/bin/bigWigInfo')
);
foreach ($FORMAT_BINS as $type=>$FORMAT_BIN) {
  $output = array();
  exec("$FORMAT_BIN " . escapeshellarg($_GET['url']), $output, $exit_code);
  if ($exit_code === 0) { bigformat_track_def($_GET['url'], $type); }
}
// If the URL ends in one of these known suffixes, we guess it's the corresponding big format and
// again provide the barebones track definition line.
$FORMAT_MATCHERS = array(
  "bam" => '/\\.bam$/',
  "vcftabix" => '/\\.vcf\\.gz$/'
);
foreach ($FORMAT_MATCHERS as $type=>$FORMAT_MATCHER) {
  if (preg_match($FORMAT_MATCHER, $_GET['url'])) { bigformat_track_def($_GET['url'], $type); }
}

proxy($_GET['url']);