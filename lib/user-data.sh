# echo "====================== Installing Dependancies ======================"

# sudo yum update -y
# sudo curl -o /etc/yum.repos.d/msprod.repo https://packages.microsoft.com/config/rhel/9/prod.repo
# sudo ACCEPT_EULA=Y yum install mssql-tools -y
# sudo yum install jq -y

# sudo yum install aspnetcore-runtime-8.0 -y
# sudo yum install dotnet-sdk-8.0 -y
# dotnet tool install --global x
# . /etc/profile.d/dotnet-cli-tools-bin-path.sh
# dotnet sdk check
# echo "export PATH=$PATH:/usr/local/bin" >> /home/ec2-user/.bashrc
# echo "export PATH=$PATH:/opt/mssql-tools/bin" >> /home/ec2-user/.bashrc
# source /home/ec2-user/.bashrc

# echo "====================== Done Installing Dependancies ======================"

# echo "====================== Database Check ======================"

# credentials=$(aws secretsmanager get-secret-value --secret-id tpb-rds-credentials --region eu-west-1 --query SecretString --output text)
# username=$(echo $credentials | jq -r '.username')
# password=$(echo $credentials | jq -r '.password')
# host=$(echo $credentials | jq -r '.host')
# port=$(echo $credentials | jq -r '.port')

# database_exists() {
#     local database_name="$1"
#     local query="SELECT COUNT(*) FROM sys.databases WHERE name = '$database_name'"
#     local result=$(sqlcmd -S "$host,$port" -U "$username" -P "$password" -h -1 -Q "$query")
#     [[ "$result" -gt 0 ]]
# }

# database_name="TaskProgressDB"

# if database_exists "$database_name"; then
#     echo "Database '$database_name' already exists."
# else
#     sqlcmd -S "$host,$port" -U "$username" -P "$password" -Q "use master; CREATE DATABASE $database_name;"
#     sqlcmd -S "$host,$port" -U "$username" -P "$password" -Q "use $database_name;"
#     echo "Database '$database_name' created."
# fi

# echo "====================== Done Database Check ======================"

# cd /home/ec2-user/
# mkdir server
# sudo chown ec2-user:ec2-user /home/ec2-user/server/

# echo "====================== Init Server Service ======================"

# connect_string="Data Source=$host,$port;Initial Catalog=$database_name;User ID=$username;Password=$password;Connect Timeout=30;Encrypt=True;Trust Server Certificate=True;Application Intent=ReadWrite;Multi Subnet Failover=False"

# cat <<CONF | sudo tee /etc/systemd/system/server.conf > /dev/null
# ASPNETCORE_ENVIRONMENT=Production
# DB_CONNECTION_STRING="$connect_string"
# ASPNETCORE_URLS=http://0.0.0.0:5000
# Cognito_UserPoolId=eu-west-1_PxnrTbF9l
# Cognito_ClientId=66lc4rli2hjagrads5atsjbumg
# Cognito_Authority=https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_PxnrTbF9l
# CONF

# cat <<'SERVICE' | sudo tee /etc/systemd/system/server.service > /dev/null
# [Unit]
# Description=Server Service
# After=network.target

# [Service]
# EnvironmentFile=/etc/systemd/system/server.conf
# User=ec2-user
# WorkingDirectory=/home/ec2-user/server/
# ExecStart=/usr/bin/dotnet /home/ec2-user/server/Server.dll 
# ExecStop=
# Restart=always
# RestartSec=3

# [Install]
# WantedBy=multi-user.target
# SERVICE

# sudo systemctl daemon-reload
# sudo systemctl enable server.service
# sudo systemctl start server.service

# echo "====================== Done Init Server Service ======================"