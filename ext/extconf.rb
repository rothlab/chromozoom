# Loads mkmf which is used to make makefiles for Ruby extensions
require 'mkmf'

$CFLAGS << ' -ggdb -O0' if ARGV.size > 0 && ARGV[0] == 'debug'

# Give it a name
extension_name = 'png_fifo_chunker'

# The destination
dir_config(extension_name)

# Do the work
create_makefile(extension_name)