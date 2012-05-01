require 'rubygems'
require 'json'
require 'uri'
require 'cgi'
require File.expand_path('../core_ext', __FILE__)

class ImageMap
  attr_reader :areas
  
  def initialize(width, genome_config, elem=nil, chr=nil)
    @areas = []
    @width = width
    @genome_config = genome_config
    @chr = chr
    areas_from_elem(elem) unless elem.nil?
  end
  
  def <<(pix)
    raise "must lshift #{self.class} with numeric" unless pix.is_a? Numeric
    @width -= pix
    @areas.each{|a| a[0] = [a[0] - pix, 0].max; a[2] -= pix }
    @areas = @areas.reject{|a| a[2] < 0}
    self
  end
  alias :lshift :<<
  
  def push(map, width)
    raise "must push #{self.class} to #{self.class}" unless map.is_a? self.class or map.nil?
    raise "width must be numeric" unless width.is_a? Numeric
    map.areas.each{|a| a = a.clone; a[0] += @width; a[2] += @width; @areas.push a} unless map.nil?
    @width += width
    self
  end

  def read(left_pix=nil)
    left_pix ||= 1.0/0    # default = Infinity, or all areas
    @areas.find_all{|a| a[0] <= left_pix}.map do |a| 
      a = a.clone
      a[2] = [a[2], left_pix].min
      a
    end.to_json
  end
  
  def read!(left_pix=nil)
    json = read left_pix
    self << left_pix if left_pix
    json
  end
  
  def save(loc, left_pix=nil, lshift=false)
    File.open(loc, 'w') {|f| f.write(lshift ? read!(left_pix) : read(left_pix)) }
  end
  
  def save!(loc, left_pix=nil); save(loc, left_pix, true); end
  
  private
  def areas_from_elem(elem)
    raise "invalid Nokogiri element, must be <map>" unless elem.is_a? Nokogiri::XML::Element and elem.name=="map"
    elem.css('[shape=RECT]').each do |e|
      next if e['coords'].nil?
      @areas.push(e['coords'].split(',').map{|c| c.to_i} + [e['title'] || e['alt']] + [fix_href(e['href'])])
    end
  end
  
  def fix_href(href)
    u = URI.parse href
    qh = CGI.parse u.query
    qh.delete 'hgsid' if qh['hgsid']
    qh['db'] = @genome_config['_name']
    qh['c'] = @chr || @genome_config['chr_order'].first
    qh['l'] = 1
    qh['r'] = 2
    u.query = qh.to_query
    u.to_s
  end
end