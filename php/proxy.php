<?php
/**
 * This page proxies an HTTP request so that genobrowser can fetch tracks via AJAX.
 *
 * To prevent abuse, it only performs GET requests and if a content-type header is fetched,
 * it has to contain "text/plain".  Also, the first line that does not start with # (used for comments)
 * must start with "browser" or "track."  This restricts usage of this proxy to just textual data that
 * looks like a valid UCSC custom track file, which will (hopefully) curb any desire to use it illicitly.
 **/
function forbidden() { header('HTTP/1.1 403 Forbidden'); exit; }

// Determines if the $buffer looks like the beginning of a valid custom track file for the UCSC browser.
function is_track($buffer) {
  $body_first = ltrim(preg_replace('/^#.*$/m', '', $buffer));       // discard inital whitespace and comment lines
  $is_track = preg_match('/^(browser|track)\\s/', $body_first)===1;
  if (!$is_track && strlen($body_first) < 7) { return NULL; }       // haven't received enough data to make a ruling
  return $is_track;
}
 
if (!isset($_GET['url']) || !preg_match('#^https?://#', $_GET['url'])) { forbidden(); }

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
  $header_lines = preg_split('/[\\r\\n]+/', $header);
  foreach ($header_lines as $index=>$line) {
    if (preg_match('/^\\s*Content-Type\\s*:\\s*(.*)/i', $line, $matches)) { $content_type = $matches[1]; }
  }
  if ($content_type !== NULL && strpos($content_type, 'text/plain')===FALSE) { 
    if (!headers_sent()) { forbidden(); }
    return $len;
  }
  if (!headers_sent()) { header('Content-Type: ' . $content_type); }
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
