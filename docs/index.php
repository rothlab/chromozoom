<?php
include_once "markdown.php";
?>
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link href="docs.css" rel="stylesheet"></link>
  <title>ChromoZoom User Guide</title>
</head>
<body>

<div id="toc-wrapper"></div>

<div id="content">
<?php echo Markdown(file_get_contents('USER-GUIDE.md')); ?>
</div>

<script src="../js/jquery.min.js"></script>
<script src="docs.js"></script>

</body>
</html>