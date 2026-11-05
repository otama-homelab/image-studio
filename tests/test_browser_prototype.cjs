'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PrototypeSession} = require('../docs/browser/prototype/session.js');
const complete = (s, name) => { const j = s.start(name); assert.equal(s.finish(j),true); return j; };

test('initial background needs preparation, repeat preserves cache and exposes two save actions', () => {
  const s = new PrototypeSession(); s.choose('background');
  const first = s.start('background'); assert.equal(first.preparing,true);
  s.finish(first); assert.equal(s.canSave('background'),true);
  s.save('background','背景付きPNG'); s.save('background','透過PNG');
  assert.equal(s.start('background').preparing,false);
});
test('direct crop and print need no model cache and guides do not invalidate output', () => {
  const s = new PrototypeSession(); s.choose('crop'); complete(s,'crop');
  s.change('crop',{guides:false}); assert.equal(s.canSave('crop'),true);
  const pending = s.start('crop'); s.change('crop',{guides:true});
  assert.equal(s.finish(pending),true);
  s.transfer('crop','print'); complete(s,'print');
  assert.equal(s.cache,false); assert.equal(s.canSave('print'),true);
});
test('upstream color and crop changes invalidate descendants until explicit refresh and generation', () => {
  const s = new PrototypeSession(); s.choose('background'); complete(s,'background');
  s.transfer('background','crop'); complete(s,'crop'); s.transfer('crop','print'); complete(s,'print');
  s.change('background',{color:'#FFFFFF'});
  assert.equal(s.canSave('background'),true); assert.equal(s.canSave('crop'),false); assert.equal(s.canSave('print'),false);
  assert.throws(() => s.save('print','PDF'));
  s.refresh('crop'); complete(s,'crop'); s.refresh('print'); complete(s,'print');
  s.change('crop',{x:70}); assert.equal(s.canSave('print'),false);
});
test('cancellation, photo replacement, and refinement changes reject captured late jobs', () => {
  const s = new PrototypeSession(); s.choose('background'); const a = s.start('background');
  s.cancel(); assert.equal(s.finish(a),false);
  const b = s.start('background'); s.choose('background','B'); assert.equal(s.finish(b),false);
  const c = s.start('background'); s.change('background',{refine:false}); assert.equal(s.finish(c),false);
  assert.equal(s.canSave('background'),false);
});
test('download/output failures retain photo and settings and permit explicit retry', () => {
  const s = new PrototypeSession(); s.choose('background'); const id = s.stages.background.input.id;
  for (const fault of ['download','save']) {
    s.fault = fault; const j = s.start('background'); assert.equal(s.finish(j),false);
    assert.equal(s.stages.background.input.id,id); assert.equal(s.canSave('background'),false);
  }
  complete(s,'background'); assert.equal(s.canSave('background'),true);
});
test('GPU loss blocks background but manual crop works without a CPU mask fallback', () => {
  const s = new PrototypeSession(); s.choose('background'); s.fault = 'gpu'; s.finish(s.start('background'));
  assert.equal(s.gpu,false); assert.throws(() => s.start('background'));
  s.choose('crop'); complete(s,'crop'); assert.equal(s.canSave('crop'),true);
});
test('independent print input survives unrelated background edits and navigation', () => {
  const s = new PrototypeSession(); s.choose('print'); complete(s,'print');
  s.choose('background'); s.change('background',{color:'#FFFFFF'}); s.screen='crop';
  assert.equal(s.canSave('print'),true);
});
test('invalid drafts block save and start without silently changing committed values', () => {
  const s = new PrototypeSession(); s.choose('crop'); complete(s,'crop');
  s.stages.crop.drafts.width=''; assert.equal(s.stages.crop.settings.width,30);
  assert.equal(s.canSave('crop'),false); assert.throws(() => s.start('crop')); assert.throws(() => s.save('crop','PNG'));
  s.change('crop',{width:35}); complete(s,'crop'); assert.equal(s.canSave('crop'),true);
});
test('nonfinite/non300 dpi, oversized print and cyclic transfers are rejected', () => {
  const s = new PrototypeSession();
  for (const dpi of [96,NaN,Infinity]) { s.choose('print','bad',dpi); assert.throws(() => s.start('print')); }
  s.choose('print','large',300,true); assert.throws(() => s.start('print'));
  s.choose('crop'); complete(s,'crop'); assert.throws(() => s.transfer('crop','background'));
});
test('offline requires a cached model for background and never blocks manual stages', () => {
  const s = new PrototypeSession(); s.online = false; s.choose('background');
  assert.throws(() => s.start('background')); assert.equal(s.failure.code,'offline');
  s.choose('crop'); complete(s,'crop');
  s.recover('connection'); complete(s,'background');
  s.online = false; complete(s,'background'); assert.equal(s.canSave('background'),true);
});
test('quota/corruption/allocation/shape failures preserve input and require explicit recovery', () => {
  for (const fault of ['quota','corrupt','memory','shape']) {
    const s = new PrototypeSession(); s.choose('background'); const id = s.stages.background.input.id;
    s.fault = fault; const j = s.start('background'); assert.equal(s.finish(j),false);
    assert.equal(s.failure.code,fault); assert.equal(s.stages.background.input.id,id);
    assert.equal(s.canSave('background'),false); assert.equal(s.cache,false);
    if (fault === 'quota' || fault === 'corrupt') s.recover('cache');
    assert.equal(s.job,null); complete(s,'background'); assert.equal(s.failure,null);
  }
});
test('failed preflight does not leak an injected fault into the next manual operation', () => {
  const s = new PrototypeSession(); s.choose('background'); s.gpu=false; s.fault='gpu';
  assert.throws(() => s.start('background'));
  s.choose('crop'); complete(s,'crop'); assert.equal(s.canSave('crop'),true);
});
