/* C08: deterministic, model-free editing state for the interaction prototype. */
(function (root) {
  'use strict';
  class PrototypeSession {
    constructor({operationTracker=null} = {}) {
      this.operationTracker = operationTracker;
      this.operationHandle = null;
      this.sequence = 0;
      this.screen = 'start';
      this.cache = false;
      this.gpu = true;
      this.online = true;
      this.failure = null;
      this.job = null;
      this.message = '';
      this.fault = '';
      this.stages = Object.fromEntries(['background', 'crop', 'print'].map(name => [name, {
        input: null, revision: 0, result: null, drafts: {},
        settings: name === 'background' ? {color: '#F5F3EF', refine: true} :
          name === 'crop' ? {width: 30, height: 40, range: 100, x: 50, y: 50, guides: true} : {paper: 'A4'},
      }]));
      this.alphaInput = null;
    }
    get activeJob() { return this.operationTracker?.getSnapshot() ?? null; }
    key(name) {
      const stage = this.stages[name];
      if (!stage.input) return null;
      if (stage.input.origin) {
        const upstream = stage.input.origin;
        if (!this.canSave(upstream) || stage.input.upstreamKey !== this.key(upstream)) return null;
      }
      return `${stage.input.id}:${stage.revision}`;
    }
    canSave(name) {
      const stage = this.stages[name], key = this.key(name);
      return !!key && Object.keys(stage.drafts).length === 0 && stage.result?.key === key;
    }
    cancel() {
      if (this.job) {
        const handle = this.operationHandle; this.operationHandle = null;
        handle?.markCancelling();
        this.job = null;
        this.message = '処理を中止しました。写真と設定は残っています。';
        handle?.finish();
      }
    }
    choose(name, label = 'ダミー写真A', dpi = 300, oversized = false) {
      this.cancel();
      const stage = this.stages[name];
      stage.input = {id: ++this.sequence, label, dpi, oversized};
      stage.revision++;
      stage.result = null;
      stage.drafts = {};
      if (name === 'background') this.alphaInput = null;
      if (name === 'crop') Object.assign(stage.settings, {range: 100, x: 50, y: 50});
      this.message = `${label}を選びました。`;
      this.failure = null;
    }
    change(name, patch) {
      const stage = this.stages[name];
      // Guide visibility is independent of in-flight processing and artifacts.
      if (Object.keys(patch).every(key => key === 'guides')) {
        Object.assign(stage.settings, patch);
        return;
      }
      this.cancel();
      Object.assign(stage.settings, patch);
      for (const key of Object.keys(patch)) delete stage.drafts[key];
      stage.revision++;
      if (name === 'background' && 'refine' in patch) this.alphaInput = null;
      if (name === 'background' && this.alphaInput === stage.input?.id) {
        stage.result = {key: this.key(name), kind: 'composite'};
        this.message = '背景色を反映しました（疑似合成・再推論なし）。';
      } else this.message = '設定が変わりました。最新の設定で作成してください。';
    }
    transfer(from, to) {
      if (!({background: ['crop', 'print'], crop: ['print']}[from] || []).includes(to)) throw new Error('この工程間では受渡しできません。');
      if (!this.canSave(from)) throw new Error('最新の結果を作成してください。');
      this.cancel();
      const stage = this.stages[to];
      stage.input = {id: ++this.sequence, label: `${from === 'background' ? '背景付き' : 'サイズ調整済み'}の画像`,
        origin: from, upstreamKey: this.key(from), dpi: 300, oversized: false};
      stage.revision++;
      stage.result = null;
      stage.drafts = {};
      this.screen = to;
      this.message = '画像を受け取りました。';
    }
    refresh(name) {
      const origin = this.stages[name].input?.origin;
      if (!origin) throw new Error('受渡し元がありません。');
      this.transfer(origin, name);
    }
    fail(name, code, message) {
      this.failure = {name, code, message};
      throw new Error(message);
    }
    start(name) {
      const fault = this.fault;
      this.fault = '';
      if (this.job) throw new Error('実行中の処理を中止してください。');
      const stage = this.stages[name], key = this.key(name);
      if (Object.keys(stage.drafts).length) throw new Error('入力欄の値を修正してください。');
      if (!key) throw new Error('写真を選ぶか、最新画像を反映してください。');
      if (name === 'background' && !this.gpu) {
        this.fail(name,'gpu','この端末では背景を変更できません。サイズ調整・印刷は利用できます。');
      }
      if (name === 'background' && !this.cache && !this.online) {
        this.fail(name,'offline','この機能に必要なモデルが保存されていません。接続して取得するか、手動サイズ・印刷を利用できます。');
      }
      if (name === 'crop') {
        const {width, height, range, x, y} = stage.settings;
        if (![width, height, range, x, y].every(Number.isFinite) || width < 9 || width > 152 || height < 9 || height > 152 || range < 10 || range > 100 || x < 0 || x > 100 || y < 0 || y > 100) throw new Error('寸法・範囲・位置を有効な数値で入力してください。');
      }
      if (name === 'print' && (!Number.isFinite(stage.input.dpi) || Math.abs(stage.input.dpi - 300) > .1)) {
        this.fail(name,'dpi','300dpiの写真を使用してください。サイズ調整から作り直せます。');
      }
      if (name === 'print' && stage.input.oversized) {
        this.fail(name,'fit','写真が用紙に収まりません。サイズ調整で小さくしてください。');
      }
      this.operationHandle = this.operationTracker?.begin(name === 'background'
        ? {kind:'inference',key:{inputId:`prototype-input-${stage.input.id}`,inferenceRevision:stage.revision,modelVersion:'prototype-only'}}
        : {kind:name === 'crop' ? 'resize' : 'paper',sourceAssetId:`prototype-input-${stage.input.id}`,dependencyKey:key}) ?? null;
      const job = {operationId:this.operationHandle?.operationId ?? null,id: ++this.sequence, name, key, input: stage.input.id,
        preparing: name === 'background' && !this.cache, step: 0, fault};
      this.failure = null;
      this.job = job;
      this.message = job.preparing ? '疑似データを取得しています…' : '疑似処理を実行しています…';
      return {...job};
    }
    tick(id, operationId) {
      if (this.job?.id !== id || (operationId !== undefined && this.job.operationId !== operationId)) return false;
      this.job.step++;
      return true;
    }
    finish(job) {
      // Retained timers deliberately call this even after cancellation/replacement.
      if (this.job?.id !== job.id || this.job.operationId !== job.operationId || this.key(job.name) !== job.key) return false;
      const handle = this.operationHandle; this.operationHandle = null;
      this.job = null;
      if (job.fault) {
        if (job.fault === 'gpu') this.gpu = false;
        if (job.fault === 'corrupt') this.cache = false;
        this.failure = {code: job.fault, name: job.name};
        this.message = ({download: 'データを取得できませんでした。写真はそのままで再試行できます。',
          quota: 'モデルを保存する空き容量が足りません。保存済みデータを削除して再試行できます。',
          corrupt: 'モデルのデータを確認できませんでした。疑似破損データを破棄しました。再取得できます。',
          memory: '背景処理に必要なメモリを確保できませんでした。解放後に再試行するか、手動サイズ・印刷を利用できます。',
          shape: '処理結果を確認できませんでした。この結果は保存しません。再試行できます。',
          gpu: '画像処理が中断されました。端末の疑似復旧後に再試行するか、サイズ調整へ進めます。',
          save: '保存用ファイルを作れませんでした。同じ写真から再生成できます。'})[job.fault];
        this.failure.message = this.message;
        handle?.finish();
        return false;
      }
      if (job.name === 'background') {
        this.cache = true;
        this.alphaInput = job.input;
      }
      this.stages[job.name].result = {key: job.key, kind: job.name};
      this.message = '疑似結果ができました。保存操作を確認できます。';
      this.failure = null;
      handle?.finish();
      return true;
    }
    recover(kind) {
      this.cancel();
      if (kind === 'connection') this.online = true;
      else if (kind === 'gpu') this.gpu = true;
      else if (kind === 'cache') this.cache = false;
      else throw new Error('復旧操作を確認してください。');
      this.failure = null;
      this.message = '疑似復旧を行いました。写真と設定は保持しています。再試行してください。';
    }
    save(name, format) {
      if (!this.canSave(name)) throw new Error('最新の結果を作成してください。古い結果は保存できません。');
      this.message = `${format}の保存操作を確認しました。プロトタイプのためファイルは生成しません。`;
    }
  }
  if (typeof module !== 'undefined') module.exports = {PrototypeSession};
  else root.PrototypeSession = PrototypeSession;
})(typeof globalThis !== 'undefined' ? globalThis : this);
