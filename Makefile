server=server1.js
cmd := node `pwd`/$(server)
server: kill; $(cmd) &
kill:; -pkill -f "$(cmd)"
