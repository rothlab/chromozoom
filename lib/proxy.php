<?php

require_once dirname(__FILE__) . "/setup.php";

$header = '';
$is_track = NULL;
$body_buffer = '';

// Determines if the $buffer looks like the beginning of a valid custom track file for the UCSC browser,
// or a plausible GenBank, EMBL, or FASTA file
function is_track($buffer) {
  $body_first = ltrim(preg_replace('/^#.*$/m', '', $buffer));       // discard inital whitespace and comment lines
  $is_track = preg_match('/^(browser|track|LOCUS|[A-Z]{2} {3}|[>;])\\s/', $body_first)===1;
  if (!$is_track && strlen($body_first) < 7) { return NULL; }       // haven't received enough data to make a ruling
  return $is_track;
}

// Shove all header data into a global variable
function receive_header_data($ch, $header_data) {
  global $header;
  $header .= $header_data;
  return strlen($header_data);
}

function receive_body($ch, $body_data) {
  global $header, $is_track, $body_buffer;
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
  if (($acao === NULL || $acao !== '*') && !valid_content_type($content_type)) {
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

function proxy($url) { 
  global $header, $is_track, $body_buffer;

  // Not nearly as efficient, but in a PHP environment without curl, it's better than nothing.
  if (!function_exists('curl_init')) {
    $buffer = file_get_contents($url);
    if (is_track($buffer)) { echo $buffer; }
    else { forbidden(); }
    exit;
  }

  $ch = curl_init($url);
  $header = '';
  $is_track = NULL;
  $body_buffer = '';
  
  curl_setopt($ch, CURLOPT_TIMEOUT, 300);
  curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
  curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
  curl_setopt($ch, CURLOPT_HEADERFUNCTION, 'receive_header_data');
  curl_setopt($ch, CURLOPT_WRITEFUNCTION, 'receive_body');
  curl_exec($ch);
  curl_close($ch);
}
