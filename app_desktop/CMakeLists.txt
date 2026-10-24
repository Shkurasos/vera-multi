cmake_minimum_required(VERSION 3.21)
project(VeraDesktop VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

find_package(Qt6 6.8 REQUIRED COMPONENTS Core Gui Network Qml Quick QuickControls2)
# Realtime needs Qt WebSockets. Without it the client still works over REST.
find_package(Qt6 6.8 QUIET OPTIONAL_COMPONENTS WebSockets)

qt_standard_project_setup(REQUIRES 6.8)

qt_add_executable(VeraDesktop
    src/main.cpp
)
set_target_properties(VeraDesktop PROPERTIES WIN32_EXECUTABLE ON)

set(VERA_QML_FILES
    qml/Main.qml
    qml/LoginPage.qml
    qml/ChatListPage.qml
    qml/ChatView.qml
    qml/MessageBubble.qml
)
# Place QML files at the module root so they share the module's qmldir.
foreach(qml_file IN LISTS VERA_QML_FILES)
    get_filename_component(qml_name "${qml_file}" NAME)
    set_source_files_properties("${qml_file}" PROPERTIES QT_RESOURCE_ALIAS "${qml_name}")
endforeach()

qt_add_qml_module(VeraDesktop
    URI Vera
    VERSION 1.0
    QML_FILES ${VERA_QML_FILES}
    SOURCES
        src/AppController.h src/AppController.cpp
        src/ApiClient.h src/ApiClient.cpp
        src/PersistentCookieJar.h src/PersistentCookieJar.cpp
        src/SocketClient.h src/SocketClient.cpp
        src/ChatListModel.h src/ChatListModel.cpp
        src/MessageModel.h src/MessageModel.cpp
        src/Formatting.h src/Formatting.cpp
)

# The generated QML type registrations include the headers as <AppController.h>.
target_include_directories(VeraDesktop PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")

target_link_libraries(VeraDesktop PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Network
    Qt6::Qml
    Qt6::Quick
    Qt6::QuickControls2
)

if(TARGET Qt6::WebSockets)
    target_link_libraries(VeraDesktop PRIVATE Qt6::WebSockets)
    target_compile_definitions(VeraDesktop PRIVATE VERA_HAS_WEBSOCKETS)
else()
    message(WARNING "Qt6 WebSockets not found: realtime updates are disabled. "
                    "Install the 'Qt WebSockets' module via Qt Maintenance Tool.")
endif()

if(WIN32)
    # DPAPI (CryptProtectData) encrypts the stored session cookies.
    target_link_libraries(VeraDesktop PRIVATE crypt32)
endif()

# ─── Tests ───────────────────────────────────────────────────────────────────
# Unit tests always run. The integration part runs only when VERA_TEST_SERVER
# points to a running Server/server.js (it registers throwaway users there).
option(VERA_BUILD_TESTS "Build tests" ON)
find_package(Qt6 6.8 QUIET OPTIONAL_COMPONENTS Test)
if(VERA_BUILD_TESTS AND TARGET Qt6::Test)
    enable_testing()
    qt_add_executable(tst_vera
        tests/tst_vera.cpp
        src/ApiClient.cpp
        src/PersistentCookieJar.cpp
        src/ChatListModel.cpp
        src/MessageModel.cpp
        src/Formatting.cpp
        src/SocketClient.cpp
    )
    target_include_directories(tst_vera PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")
    target_link_libraries(tst_vera PRIVATE Qt6::Core Qt6::Network Qt6::Qml Qt6::Test)
    if(TARGET Qt6::WebSockets)
        target_link_libraries(tst_vera PRIVATE Qt6::WebSockets)
        target_compile_definitions(tst_vera PRIVATE VERA_HAS_WEBSOCKETS)
    endif()
    if(WIN32)
        target_link_libraries(tst_vera PRIVATE crypt32)
    endif()
    add_test(NAME tst_vera COMMAND tst_vera)
endif()