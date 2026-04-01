OUT_FILE="$1.tar"

docker save -o $OUT_FILE $1
mv $OUT_FILE ~/docker-images