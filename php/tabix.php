<?php
/**
 * This page runs a URL to a tabix-indexed file and a series of positions through tabix.
 * Symlink tabix to the ../bin directory
 **/
function bad_request() {
  header('HTTP/1.1 403 Forbidden');
  exit;
}
 
if (!isset($_GET['url']) || !preg_match('#^https?://#', $_GET['url'])) { bad_request(); }
if (!isset($_GET['range'])) { bad_request(); } 
else { $range = array_filter((array) $_GET['range']); }
if (!count($range)) { bad_request(); }

$TABIX = escapeshellarg(dirname(dirname(__FILE__)) . '/bin/tabix');

$tmp_dir = '/tmp/tabix-' . substr(strtr(base64_encode(sha1(dirname($_GET['url']), TRUE)), '/', '-'), 0, 12);
while (file_exists($tmp_dir) && !is_dir($tmp_dir)) { $tmp_dir .= '+'; } 
if (!file_exists($tmp_dir)) { mkdir($tmp_dir); }
chmod($tmp_dir, 0755);
chdir($tmp_dir);
header('Content-type: text/plain');
passthru("$TABIX " . escapeshellarg($_GET['url']) . " " . implode(' ', array_map('escapeshellarg', $range)));
