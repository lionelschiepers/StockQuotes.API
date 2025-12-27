docker build -t lionelschiepers/stockquote-node-api -f .\Dockerfile .
docker push lionelschiepers/stockquote-node-api:latest

docker run --rm -v /var/run/docker.sock:/var/run/docker.sock nickfedor/watchtower --cleanup --run-once

@REM automatically update the docker container using watchtower
@REM sudo docker run -d --name=watchtower -v /var/run/docker.sock:/var/run/docker.sock --restart=always -e WATCHTOWER_POLL_INTERVAL=3600 nickfedor/watchtower --cleanup
@REM sudo docker run --rm -v /var/run/docker.sock:/var/run/docker.sock nickfedor/watchtower --cleanup --run-once
