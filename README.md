<a href="http://hapijs.com"><img src="https://raw.githubusercontent.com/hapijs/assets/master/images/family.png" width="180px" align="right" /></a>

# @hapi/sntp

An SNTP v4 client (RFC4330) for node. Simpy connects to the NTP or SNTP server requested and returns the server time
along with the roundtrip duration and clock offset. To adjust the local time to the NTP time, add the returned `t` offset
to the local time.

[![Build Status](https://secure.travis-ci.org/hapijs/sntp.svg?branch=master)](http://travis-ci.org/hapijs/sntp)
