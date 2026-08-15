this bot was originally made for HestiaRBW since the owner was a dickhead i quit it (i got paid less and they were jus racist) and me and asher recoded this to revive ayor rbw and it ended horribly so i decided to make this sourcecode completely public and free to use any one can use this/update this for their own sake

# if any issues found over run time please make a issue on this repo or contact [confessingtoday](https://discord.gg/ygueB6rZRX) on discord

# note for contributers

please follow same structure and variables naming method as the current codebase. before making any pull requests make sure the code is well tested and error free (logical and run time)

# testing

```bash
mvn test   # runs the JUnit 5 suite (src/test/java) plus compile + package
```

# note on vendored libraries

`src/main/java/com/deyo/rbw/libs/` contains two JARs referenced as `system` scope
dependencies:

- `bungeecord-chat-1.8.jar` - legacy chat API for the 1.8.8 build target
- `bedwars-api-25.6.jar` - BedWars1058 API. The official repo
  (`repo.andrei1058.dev`) now serves a JS challenge page instead of artifacts
  for unauthenticated Maven clients, which corrupts the local cache. This jar
  was built from the BedWars1058 GitHub source at tag `25.6`
  (`bedwars-api` module, ISidebar/ISidebarService/PlayerSidebarInitEvent
  classes compiled against bundled sidebar stubs).

To rebuild it yourself:

```bash
git clone --branch 25.6 --depth 1 https://github.com/andrei1058/BedWars1058
cd BedWars1058/bedwars-api
mvn package -DskipTests
# then replace libs/bedwars-api-25.6.jar with target/bedwars-api-25.6.jar
```



