echo "====================== Installing Dependancies ======================"

sudo yum update -y
sudo yum install jq -y
sudo yum install -y https://download.postgresql.org/pub/repos/yum/14/redhat/rhel-7-x86_64/postgresql14-libs-14.9-2PGDG.rhel7.x86_64.rpm
sudo yum install -y https://download.postgresql.org/pub/repos/yum/14/redhat/rhel-7-x86_64/postgresql14-14.9-2PGDG.rhel7.x86_64.rpm
### download the NodeJS binary (x86 only) 
wget -nv https://d3rnber7ry90et.cloudfront.net/linux-x86_64/node-v18.17.1.tar.gz
tar -xf node-v18.17.1.tar.gz
sudo mkdir -p /usr/local/lib/nodejs
sudo mv node-v18.17.1 /usr/local/lib/nodejs

# Set environment variables system-wide
sudo sh -c 'echo "export NODEJS_HOME=/usr/local/lib/nodejs/node-v18.17.1" > /etc/profile.d/nodejs.sh'
sudo sh -c 'echo "export PATH=\$NODEJS_HOME/bin:\$PATH" >> /etc/profile.d/nodejs.sh'
sudo chmod +x /etc/profile.d/nodejs.sh

# Reload environment variables
source /etc/profile

# Verify installation
node -v
npm -v
sudo npm install -g ts-node
ts-node -v
# https://repost.aws/questions/QUvkkhY--uTiSDkS6R1jFnZQ/node-js-18-on-amazon-linux-2

echo "====================== Done Installing Dependancies ======================"

echo "====================== Database Check ======================"

credentials=$(aws secretsmanager get-secret-value --secret-id short-term-lender-rds-credentials --region eu-west-1 --query SecretString --output text)
username=$(echo $credentials | jq -r '.username')
password=$(echo $credentials | jq -r '.password')
host=$(echo $credentials | jq -r '.host')
port=$(echo $credentials | jq -r '.port')

database_exists() {
    local database_name="$1"
    local query="SELECT 1 FROM pg_database WHERE datname = '$database_name';"
    local result=$(PGPASSWORD="$password" psql -h "$host" -p "$port" -U "$username" -d "stloansdb" -t -c "$query")
    
    if [[ "$result" -eq 1 ]]; then
        return 0
    else
        return 1
    fi
}

database_name="stloansdb"

if database_exists "$database_name"; then
    echo "Database '$database_name' already exists."
else
    PGPASSWORD="$password" psql -h "$host" -p "$port" -U "$username" -d "stloansdb" -c "use master; CREATE DATABASE $database_name;"
    echo "Database '$database_name' created."
fi

echo "====================== Done Database Check ======================"

cd /home/ec2-user/
mkdir server
sudo chown ec2-user:ec2-user /home/ec2-user/server/

echo "====================== Init Server Service ======================"

cat <<CONF | sudo tee /etc/systemd/system/server.conf > /dev/null
DB_HOST="$host"
DB_PORT="$port"
DB_USERNAME="$username"
DB_PASSWORD="$password"
DB_DATABASE="$database_name"
Cognito_UserPoolId=eu-west-1_1MLsU0Sws
Cognito_ClientId=5m671l5io0gcnnvlru34784ac2
Cognito_Authority=https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_1MLsU0Sws
CONF

cat <<'SERVICE' | sudo tee /etc/systemd/system/server.service > /dev/null
[Unit]
Description=Server Service
After=network.target

[Service]
EnvironmentFile=/etc/systemd/system/server.conf
User=ec2-user
WorkingDirectory=/home/ec2-user/server/
ExecStart=/usr/local/lib/nodejs/node-v18.17.1/bin/ts-node /home/ec2-user/server/src/index.ts
ExecStop=/bin/kill -TERM $MAINPID
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable server.service
sudo systemctl start server.service

echo "====================== Done Init Server Service ======================"