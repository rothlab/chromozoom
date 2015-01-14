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
function forbidden() { header('HTTP/1.1 403 Forbidden'); exit; }

// Echoes a barebones track definition line that points to a big format file
// (e.g., if the user actually selected a URL for a bigWig file).
function bigformat_track_def($url, $type) {
  $name = str_replace('"', '', basename($url));
  $url = str_replace('"', '%22', $url);
  echo "track name=\"$name\" type=\"$type\" bigDataUrl=\"$url\"\n";
  exit;
}

// Determines if the $buffer looks like the beginning of a valid custom track file for the UCSC browser,
// or a plausible GenBank, EMBL, or FASTA file
function is_track($buffer) {
  $body_first = ltrim(preg_replace('/^#.*$/m', '', $buffer));       // discard inital whitespace and comment lines
  $is_track = preg_match('/^(browser|track|LOCUS|[A-Z]{2} {3}|[>;])\\s/', $body_first)===1;
  if (!$is_track && strlen($body_first) < 7) { return NULL; }       // haven't received enough data to make a ruling
  return $is_track;
}

if (!isset($_GET['url']) || !preg_match('#^(https?|ftp)://#', $_GET['url'])) { forbidden(); }

// First check if this is actually a bigBed, bigWig, or vcfTabix file
// If the corresponding tool returns a exit code of 0, we guess that it is, and proxy back
// a barebones track definition line with a bigDataUrl equal to this URL.
$FORMAT_BINS = array(
  "bigbed" => escapeshellarg(dirname(dirname(__FILE__)) . '/bin/bigBedInfo'),
  "bigwig" => escapeshellarg(dirname(dirname(__FILE__)) . '/bin/bigWigInfo')
);
foreach ($FORMAT_BINS as $type=>$FORMAT_BIN) {
  exec("$FORMAT_BIN " . escapeshellarg($_GET['url']), $output, $exit_code);
  if ($exit_code === 0) { bigformat_track_def($_GET['url'], $type); }
}

// Not nearly as efficient, but in a PHP environment without curl, it's better than nothing.
if (!function_exists('curl_init')) {
  $buffer = file_get_contents($_GET['url']);
  if (is_track($buffer)) { echo $buffer; }
  else { forbidden(); }
  exit;
}

$ch = curl_init($_GET['url']);

$header = '';
$is_track = NULL;
$body_buffer = '';

// Shove all header data into a global variable
function receive_header_data($ch, $header_data) {
  global $header;
  $header .= $header_data;
  return strlen($header_data);
}


function receive_body($ch, $body_data) {
  global $header, $header_parsed, $is_track, $body_buffer;
  $len = strlen($body_data);
  $content_type = NULL;
  $content_length = NULL;
  $acao = NULL;
  $header_lines = preg_split('/[\\r\\n]+/', $header);
  foreach ($header_lines as $index=>$line) {
    if (preg_match('/^\\s*Content-Type\\s*:\\s*(.*)/i', $line, $matches)) { $content_type = $matches[1]; }
    if (preg_match('/^\\s*Content-Length\\s*:\\s*(.*)/i', $line, $matches)) { $content_length = $matches[1]; }
    if (preg_match('/^\\s*Access-Control-Allow-Origin\\s*:\\s*(.*)/i', $line, $matches)) { $acao = $matches[1]; }
  }
  if (($acao === NULL || $acao !== '*') && $content_type !== NULL && strpos($content_type, 'text/plain')===FALSE) {
    if (!headers_sent()) { forbidden(); }
    return $len;
  }
  if (!headers_sent() && $content_type !== NULL) { header('Content-Type: ' . $content_type); }
  if (!headers_sent() && $content_length !== NULL) { header('Content-Length: ' . $content_length); }
  // If the server compresses the content automatically (e.g. mod_deflate), we lose Content-Length
  // Adding the uncompressed length into another header allows the XHR to know how much content to expect
  if (!headers_sent() && $content_length !== NULL) { header('X-Content-Length: ' . $content_length); }
  if ($is_track===NULL) {
    $body_buffer .= $body_data;
    $is_track = is_track($body_buffer);
    if ($is_track) { echo $body_buffer; flush(); }
  } elseif ($is_track===TRUE) {
    echo $body_data;
    flush();
  } elseif ($is_track===FALSE) {
    if (!headers_sent()) { forbidden(); }
    return $len;
  }
  return $len;
}

curl_setopt($ch, CURLOPT_TIMEOUT, 300);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_HEADERFUNCTION, 'receive_header_data');
curl_setopt($ch, CURLOPT_WRITEFUNCTION, 'receive_body');
curl_exec($ch);
curl_close($ch);
