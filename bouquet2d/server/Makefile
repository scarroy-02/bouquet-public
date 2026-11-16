CXX ?= g++
CXXFLAGS ?= -std=c++17 -O3 -pthread
# No fused multiply-adds, which clang makes by default where the CPU has them (Apple silicon): they round
# a * b + c once, so the largest value could map just outside GUDHI's extended ranges and its pairs be lost.
# "override", so that it stays when CXXFLAGS is given on the command line (the macOS build)
override CXXFLAGS += -ffp-contract=off
# GUDHI, cpp-httplib and nlohmann/json are in third_party/; GUDHI also needs Boost's headers
INCLUDES := -Ithird_party/include
# PORTABLE=1 (the desktop app's build, see ../desktop/): the C++ runtime is linked in, so that the server
# needs no libraries beyond the system's (on macOS, the runtime is part of the system)
ifdef PORTABLE
ifneq ($(shell uname -s),Darwin)
LDFLAGS += -static-libstdc++ -static-libgcc
endif
endif
# Windows (MSYS2 MinGW): cpp-httplib needs Winsock and the Windows 10 API; the big object format, in case
# the object file has too many sections; link everything in, so that server.exe needs no MinGW DLLs
ifeq ($(OS),Windows_NT)
CXXFLAGS += -D_WIN32_WINNT=0x0A00 -Wa,-mbig-obj
LDLIBS += -lws2_32
LDFLAGS += -static
endif

server: server.cpp
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) $(INCLUDES) $(LDFLAGS) $< -o $@ $(LDLIBS)

test: server
	python3 test_server.py

clean:
	rm -f server server.exe

.PHONY: test clean
