# -*- mode: ruby -*-
# vi: set ft=ruby :

Vagrant.configure(2) do |config|

  # # Original virtual environment
  # config.vm.box = "hashicorp/precise64"
  
  # # Formated virtual environment
  config.vm.box = "chzoom-1"
  config.vm.box_url = "http://beta.chromozoom.org/files/chzoom-1.box"
  
  
  config.vm.network "forwarded_port", guest: 80, host: 8080
  config.vm.synced_folder ".", "/var/www/"

  # # Provision setup
  # # By default provisions are preinstall. Uncomment to (re)install them.
  config.vm.provision "shell", inline: <<-SHELL
    # sudo apt-get -y update
    # sudo apt-get install -y samtools tabix
    # sudo apt-get install -y php5
    # sudo apt-get install -y apache2
    # sudo apt-get install -y imagemagick curl
    # sudo apt-get install -y ruby ruby1.8 rake rubygems
    # sudo apt-get install -y libxslt-dev libxml2-dev
    # sudo gem install -y bundler
    # cd /var/www/ && bundle install

    # sudo apt-get -y install mysql-client-core-5.5
    # sudo apt-get -y install python-software-properties
    # sudo add-apt-repository -y ppa:fkrull/deadsnakes
    # sudo apt-get -y update
    # sudo apt-get -y install python3.4
    # sudo sh -c "wget -O - https://bootstrap.pypa.io/get-pip.py | python3.4"
    # sudo pip3.4 install pymysql
    # sudo apt-get install -y python3.4-dev
    # sudo pip3.4 install lxml

	# mkdir ~/setup/
	# for PROG in bigBedInfo bigBedSummary bigBedToBed bigWigSummary bigWigInfo twoBitToFa bedToBigBed fetchChromSizes
    # do
    #   wget -O ~/setup/"$PROG" http://hgdownload.cse.ucsc.edu/admin/exe/linux.x86_64/"$PROG"
    # done
    
	# chmod a+x ~/setup/*
    # mv ~/setup/* /usr/bin/
    
  SHELL
end
