import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nextNativeSource, releaseTag} from './forgejo-service-release.mjs';
test('stable release and malformed version rejection',()=>{assert.equal(releaseTag('5.0.0'),'v5.0.0');assert.throws(()=>releaseTag('latest'));});
test('native release changes only the declared project version',()=>{
  assert.equal(nextNativeSource('<artifactId>address</artifactId>\n<version>4.0.0</version>\n<parent><version>4.1.1</version></parent>','5.0.0','maven'),'<artifactId>address</artifactId>\n<version>5.0.0</version>\n<parent><version>4.1.1</version></parent>');
  assert.equal(nextNativeSource('group=com.omnixys\nversion=0.0.0\njavaVersion=26\n','1.0.0','gradle'),'group=com.omnixys\nversion=1.0.0\njavaVersion=26\n');
  assert.equal(nextNativeSource('[project]\nversion = "0.1.0"\ndependencies=["omnixys-observability==5.0.0"]\n','1.0.0','python'),'[project]\nversion = "1.0.0"\ndependencies=["omnixys-observability==5.0.0"]\n');
  assert.throws(()=>nextNativeSource('unexpected','1.0.0','python'));
});
