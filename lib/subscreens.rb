# Utility functions for running commands within GNU screen, particularly its split
# screen functionality

module Subscreens
  extend self
  
  # Run cmd inside num_splits split screen sessions simultaneously
  def split(num_splits, cmd)
    if ENV['STY'].nil?
      system("screen", "-c", "/dev/null", "-S", "nested", $0, *ARGV)
      return
    end

    (num_splits - 1).times do
      system('screen -X split')
    end

    num_splits.times do |i|
      system('screen -X focus') if i != 0
      system("screen -t split#{i+1} #{i+1}")
      system("screen -X -p #{i+1} stuff \"#{cmd}\n\"")
      sleep 2
      system("screen -X select #{i+1}") if i != 0
    end
  end
end