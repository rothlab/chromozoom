module TermUtil
  @@term_size = nil
  extend self
  
  # Following two methods borrowed from hirb (https://github.com/cldwalker/hirb),
  # which is MIT licensed.
  
  # Determines if a shell command exists by searching for it in ENV['PATH'].
  def command_exists?(command)
    ENV['PATH'].split(File::PATH_SEPARATOR).any? {|d| File.exists? File.join(d, command) }
  end

  # Returns [width, height] of terminal when detected, nil if not detected.
  def detect_terminal_size
    if (ENV['COLUMNS'] =~ /^\d+$/) && (ENV['LINES'] =~ /^\d+$/)
      [ENV['COLUMNS'].to_i, ENV['LINES'].to_i]
    elsif (RUBY_PLATFORM =~ /java/ || (!STDIN.tty? && ENV['TERM'])) && command_exists?('tput')
      [`tput cols`.to_i, `tput lines`.to_i]
    elsif STDIN.tty? && command_exists?('stty')
      `stty size`.scan(/\d+/).map { |s| s.to_i }.reverse
    else
      nil
    end
  rescue
    nil
  end
  
  # Prints a line on the terminal that replaces the last line instead of following it.
  def print_over(line)
    @@term_size = detect_terminal_size if @@term_size.nil?
    print "\r#{' '*@@term_size[0]}\r#{line}"
    $stdout.flush
  end
  
  # Asks a question and provides a prompt for user input
  def prompt(ask=nil, default=nil)
    print "#{ask}#{default.nil? ? (ask[/\s+\Z/] ? '' : ' ') : ' [' + default.to_s + '] '}" unless ask.nil?
    input = STDIN.gets.strip
    default.nil? ? input : (input.empty? ? default : input)
  end
  
  def grid(items)
    @@term_size = detect_terminal_size if @@term_size.nil?
    col_width = (items.map{|s| s.length }.max + 2)
    num_cols = @@term_size[0] / col_width
    lines = []
    items.map{|s| s.ljust col_width }.each_slice(num_cols){|s| lines.push(s.join('')) }
    lines.join("\n") + "\n"
  end
end