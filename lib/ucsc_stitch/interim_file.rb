# a thin wrapper to make Tempfile and File more interchangeable
class InterimFile
  attr_accessor :map, :pix_err, :pix_margin, :pix_data
  
  def initialize(exists=false, *args)
    if exists then @f = File.new(*args)
    else @f = Tempfile.new(*args)
    end
  end
  
  def change_to(*args)
    @f = File.new(*args)
  end
  
  def method_missing(sym, *args, &block)
    if sym == :close! and @f.instance_of? File then
      @f.close
      File.delete(@f.path)
    else
      @f.send sym, *args, &block
    end
  end
end