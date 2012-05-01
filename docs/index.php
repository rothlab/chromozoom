<?php
include_once "markdown.php";
?>
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link href="docs.css" rel="stylesheet"></link>
  <title>chromozoom user guide</title>
</head>
<body>
<?php echo Markdown(file_get_contents('USER-GUIDE.md')); ?>
</body>
</html>