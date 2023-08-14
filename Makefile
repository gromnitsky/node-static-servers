cmd := node `pwd`/server.js
server: kill; $(cmd) &
kill:; -pkill -f "$(cmd)"
