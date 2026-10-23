cmake_minimum_required(VERSION 3.16)
project(Vera_Multi_CPP C)

add_executable(Vera_Multi_CPP
    src/main.c
)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()