# This module uses curl and ImageMagick (from the command line) to do various things with images
#
# An appropriate enhancement would be to use RMagick (http://rmagick.rubyforge.org/)
# to keep more of the logic in Ruby, but I'm not sure that loading every image into Ruby would actually
# be a performance improvement over just spawning other processes to do the work, or an expressivity
# boost for the following code.

require 'fileutils'

module ImageManip
  private

  # Fetches an image from the current directory if no base_uri is given, otherwise, uses curl to fetch it remotely
  def fetch_img(path, to, base_uri)
    if base_uri.is_a? URI then exec_ensuring(["curl", "-s", (base_uri + path).to_s, "-o", to]) { File.exists? to }
    else FileUtils.mv(path, to); end
  end

  # ================================================================================================
  # = ImageMagick functions that combine, create, and modify images, or get information about them =
  # ================================================================================================
  
  def crop_img(from, to, geometry, into_n_tiles=false)
    args = [from, "-crop", geometry, "-page", "+0+0"] + (into_n_tiles ? ["+adjoin"] : []) + [to]
    exec_ensuring(["convert", *args]) do
      into_n_tiles ? Dir.glob(to.sub(/%d/, '*')).size == into_n_tiles : File.exists?(to)
    end
  end

  def extend_img(from, to, geometry, repage=true)
    args = [from, '-background', 'none', '-extent', geometry] + (repage ? ['-page', '+0+0'] : []) + [to]
    exec_ensuring(["convert", *args]) { File.exists? to }
  end

  def montage_imgs(from, to)
    args = from + ["-mode", "Concatenate", "-background", "none", "-tile", "x1", to]
    exec_ensuring(["montage", *args]) { File.exists? to }
  end

  def null_img(to, geometry)
    exec_ensuring(["convert", "-size", geometry, "xc:none", to]) { File.exists? to }
  end

  def resize_img(from, to, geometry)
    exec_ensuring(["convert", from, "-sample", geometry, to]) { File.exists? to }
  end

  def img_width(path_or_png); identify_property(path_or_png, '%w'); end
  
  def img_height(path_or_png); identify_property(path_or_png, '%h'); end
  
  def is_png(possible_png_data)
    possible_png_data[0..7] == "\x89PNG\x0D\x0A\x1A\x0A"
  end
  
  def identify_property(path_or_png, format)
    return 1 if path_or_png === '-' # null image from hashtable
    is_png_data = is_png(path_or_png)
    path = shellescape(is_png_data ? '-' : path_or_png)
    IO.popen("#{im_suite_prefix}identify -format '#{format}' #{path}", 'r+') do |io|
      io.write(path_or_png) && io.close_write if is_png_data
      io.read.to_i
    end
  end

  def img_content_height(file_path)
    cmd = "#{im_suite_prefix}convert #{shellescape file_path} -bordercolor none -border 1x1 -trim info:- 2>/dev/null"
    exec_ensuring(cmd) { |out| out =~ /PNG \d+x(\d+) \d+x\d+[+-]\d+([+-]\d+)/ }
    return $1.to_i + $2.to_i - 1
  end

  # probably the most wasteful way to find a red pixel in the history of computing. but whatever
  def find_red_pixel(file)
    (0..img_width(file.path)).find do |x|
      `#{im_suite_prefix}convert #{shellescape file.path} -crop 1x1+#{x}+3 txt:-`.include? '#FF0000'
    end
  end
  
  # Use GraphicsMagick instead of ImageMagick if available?  FIXME: doesn't work yet.
  def im_suite_prefix
    @use_gm = false #`which gm`.strip.size > 0 if @use_gm.nil?
    @use_gm ? "gm " : ""
  end
  
  # Executes "cmd" in a subshell until the passed block returns true, up to "num_tries" times
  def exec_ensuring(cmd, num_tries=10)
    failures = 0
    cmd = cmd.map{|arg| shellescape arg }.join(' ') unless cmd.is_a? String
    cmd = im_suite_prefix + cmd unless cmd[/^(convert|montage|identify) /].nil?
    num_tries.times do
      result = IO.popen(cmd, 'r') {|io| io.read }
      break if yield result
      failures += 1
      sleep 1
    end
    raise "Command `#{cmd}` failed #{failures} times" unless failures < num_tries
  end
  
  begin
    require 'shellwords'
    include Shellwords
  rescue LoadError    
    # Backport of Shellwords::shellescape from Ruby 1.9.x
    # From http://svn.ruby-lang.org/repos/ruby/trunk/lib/shellwords.rb
    def shellescape(str)
      # An empty argument will be skipped, so return empty quotes.
      return "''" if str.empty?

      str = str.dup

      # Process as a single byte sequence because not all shell
      # implementations are multibyte aware.
      str.gsub!(/([^A-Za-z0-9_\-.,:\/@\n])/n, "\\\\\\1")

      # A LF cannot be escaped with a backslash because a backslash + LF
      # combo is regarded as line continuation and simply ignored.
      str.gsub!(/\n/, "'\n'")

      return str
    end
  end
  
end