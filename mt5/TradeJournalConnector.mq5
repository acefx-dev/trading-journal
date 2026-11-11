//+------------------------------------------------------------------+
//|                                       TradeJournalConnector.mq5   |
//|  Sends this account's closed deals, open positions and balance    |
//|  to your Trade Journal web app. READ-ONLY: this EA contains no    |
//|  order functions and cannot open, change or close any trade.      |
//+------------------------------------------------------------------+
#property copyright   "Personal use"
#property version     "1.02"
#property description "Trade Journal connector (read-only). Sends deals, open positions and balance to your journal."
#property description "It has no trading code: it never opens, modifies or closes trades or orders."
#property description "1.02: also records stop-loss changes and the drawdown/best point of each trade."

//--- inputs
input group  "Journal"
input string InpUrl              = "https://YOUR-JOURNAL.pages.dev/api/ingest"; // Journal upload URL (.../api/ingest)
input string InpToken            = "";      // Connector token (Accounts page -> Connect)
input group  "Cloudflare Access service token (only if you use one; see README)"
input string InpAccessId         = "";      // CF-Access-Client-Id
input string InpAccessSecret     = "";      // CF-Access-Client-Secret
input group  "Timing"
input int    InpOpenIntervalSec  = 15;      // Send every N seconds while positions are open
input int    InpIdleIntervalSec  = 60;      // Send every N seconds when flat (heartbeat)
input int    InpBackfillDays     = 90;      // First run: send this many days of history
input int    InpReconcileDays    = 35;      // Daily check: compare this many days with the journal
input group  "Trade path (1.02)"
input bool   InpTrackPath        = true;    // Record stop-loss moves, drawdown and best point (checked every second)
input group  "Display"
input bool   InpShowStatus       = true;    // Show the status lines on the chart

#define CONNECTOR_VERSION "1.02"
#define MAX_DEALS_PER_SEND 200
#define MAX_POSITIONS      500
#define OVERLAP_MS         120000          // re-send the last 2 minutes of deals (duplicates are ignored)

//--- state
long     g_login       = 0;
long     g_ack         = 0;     // newest deal time (server ms) the journal has stored
bool     g_dirty       = true;  // send at the next timer tick
ulong    g_lastSendMs  = 0;
ulong    g_nextTryMs   = 0;
int      g_fails       = 0;
datetime g_lastOkLocal = 0;
datetime g_lastRecon   = 0;     // local time of the last reconciliation
string   g_status      = "Starting...";
string   g_lastError   = "";
int      g_lastSent    = 0;
long     g_missing[];           // deal tickets the journal asked for

string GvAck() { return "TJC_" + IntegerToString(g_login) + "_ack"; }

//--- trade path (1.02): per open position, the last S/L and volume seen
struct PosTrack
  {
   long   id;
   double sl;
   double vol;
   bool   seen;
  };
//--- per symbol and side: combined floating P&L of the open positions (one "episode" while any is open)
struct PathGroup
  {
   string sym;
   long   type;
   long   start;      // server time ms of the first position's open
   string ids;        // ",id1,id2,"
   double cur;
   bool   live;
   bool   hasVal;
   double mae;
   long   maeT;
   double mfe;
   long   mfeT;
   bool   partial;
  };
PosTrack  g_pt[];
PathGroup g_gr[];
string    g_ev[];        // queued S/L events (JSON), sent with the next upload
string    g_epDone[];    // finished episodes (JSON)
#define MAX_PATH_QUEUE 3000
#define MAX_EVENTS_PER_SEND 500

//+------------------------------------------------------------------+
int OnInit()
  {
   g_login = AccountInfoInteger(ACCOUNT_LOGIN);
   string url = InpUrl;
   StringTrimLeft(url);
   StringTrimRight(url);
   bool local = (StringFind(url, "http://127.0.0.1") == 0 || StringFind(url, "http://localhost") == 0);
   if(StringFind(url, "https://") != 0 && !local)
     {
      Alert("Trade Journal connector: the URL must start with https://");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(StringFind(url, "YOUR-JOURNAL") >= 0)
     {
      Alert("Trade Journal connector: set the Journal upload URL in the inputs.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(StringLen(InpToken) < 20)
     {
      Alert("Trade Journal connector: paste the connector token from the journal's Accounts page.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(GlobalVariableCheck(GvAck())) g_ack = (long)GlobalVariableGet(GvAck());
   g_dirty = true;
   g_lastRecon = 0;           // reconcile once soon after start
   EventSetTimer(1);
   Status("Starting... (account " + MaskedLogin() + ")");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(InpShowStatus) Comment("");
  }

// any trade event: send soon
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD || trans.type == TRADE_TRANSACTION_POSITION ||
      trans.type == TRADE_TRANSACTION_HISTORY_ADD)
      g_dirty = true;
  }

void OnTimer()
  {
   PathTick();
   ulong now = GetTickCount64();
   if(now < g_nextTryMs) return;
   int interval = (PositionsTotal() > 0 ? InpOpenIntervalSec : InpIdleIntervalSec);
   if(interval < 5) interval = 5;
   bool reconcileDue = (g_ack > 0 && (g_lastRecon == 0 || TimeLocal() - g_lastRecon >= 86400));
   if(!g_dirty && !reconcileDue && now - g_lastSendMs < (ulong)interval * 1000) return;
   if(!TerminalInfoInteger(TERMINAL_CONNECTED)) { Status("Waiting: this terminal is not connected to the broker"); return; }
   SyncOnce(reconcileDue);
  }

//+------------------------------------------------------------------+
//| Build and send one upload                                         |
//+------------------------------------------------------------------+
void SyncOnce(bool reconcile)
  {
   g_lastSendMs = GetTickCount64();
   datetime serverNow = TimeTradeServer();
   long offsetSec = (long)(serverNow - TimeGMT());

   //--- deals since the last acknowledged one
   datetime from = (g_ack > 0) ? (datetime)((g_ack - OVERLAP_MS) / 1000) : serverNow - (datetime)InpBackfillDays * 86400;
   if(!HistorySelect(from, serverNow + 86400)) { Status("Couldn't read the account history (will retry)"); return; }
   int total = HistoryDealsTotal();
   string deals = "";
   int nDeals = 0;
   bool more = false;
   for(int i = 0; i < total; i++)
     {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0) continue;
      long tms = HistoryDealGetInteger(t, DEAL_TIME_MSC);
      if(g_ack > 0 && tms < g_ack - OVERLAP_MS) continue;
      if(nDeals >= MAX_DEALS_PER_SEND) { more = true; break; }
      deals += (nDeals > 0 ? "," : "") + DealJson(t);
      nDeals++;
     }
   //--- deals the journal said it is missing (from the daily check)
   int nm = ArraySize(g_missing), usedMissing = 0;
   for(int k = 0; k < nm && nDeals < MAX_DEALS_PER_SEND; k++)
     {
      if(!HistoryDealSelect((ulong)g_missing[k])) { usedMissing++; continue; }
      deals += (nDeals > 0 ? "," : "") + DealJson((ulong)g_missing[k]);
      nDeals++;
      usedMissing++;
     }

   //--- open positions (full list every time)
   string pos = "";
   int np = 0;
   for(int i = 0; i < PositionsTotal() && np < MAX_POSITIONS; i++)
     {
      ulong pt = PositionGetTicket(i);
      if(pt == 0) continue;
      pos += (np > 0 ? "," : "") + PositionJson();
      np++;
     }

   //--- daily reconciliation: every deal ticket in the period
   string recon = "";
   if(reconcile)
     {
      datetime rFrom = serverNow - (datetime)InpReconcileDays * 86400;
      if(HistorySelect(rFrom, serverNow + 86400))
        {
         int rt = HistoryDealsTotal();
         string tickets = "";
         int nt = 0;
         for(int i = 0; i < rt; i++)
           {
            ulong t = HistoryDealGetTicket(i);
            if(t == 0) continue;
            tickets += (nt > 0 ? "," : "") + IntegerToString((long)t);
            nt++;
           }
         recon = ",\"reconcile\":{\"from\":" + IntegerToString((long)rFrom * 1000) + ",\"to\":" +
                 IntegerToString((long)(serverNow + 86400) * 1000) + ",\"tickets\":[" + tickets + "]}";
        }
     }

   //--- trade path: queued S/L events, finished episodes and the ones still open
   int nEv = (int)MathMin(ArraySize(g_ev), MAX_EVENTS_PER_SEND), nEp = (int)MathMin(ArraySize(g_epDone), 200);
   string path = "";
   if(InpTrackPath)
     {
      string evs = "", eps = "";
      for(int k = 0; k < nEv; k++) evs += (k > 0 ? "," : "") + g_ev[k];
      for(int k = 0; k < nEp; k++) eps += (k > 0 ? "," : "") + g_epDone[k];
      for(int k = 0; k < ArraySize(g_gr); k++)
         if(g_gr[k].hasVal) eps += (StringLen(eps) > 0 ? "," : "") + EpisodeJson(k, 0);
      path = ",\"path\":{\"events\":[" + evs + "],\"episodes\":[" + eps + "]}";
     }

   string body = "{\"v\":1,\"connector\":\"" + CONNECTOR_VERSION + "\"" +
                 ",\"login\":\"" + IntegerToString(g_login) + "\"" +
                 ",\"server\":" + JsonStr(AccountInfoString(ACCOUNT_SERVER)) +
                 ",\"company\":" + JsonStr(AccountInfoString(ACCOUNT_COMPANY)) +
                 ",\"currency\":" + JsonStr(AccountInfoString(ACCOUNT_CURRENCY)) +
                 ",\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) +
                 ",\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) +
                 ",\"server_time\":" + IntegerToString((long)serverNow * 1000) +
                 ",\"offset_sec\":" + IntegerToString(offsetSec) +
                 ",\"deals\":[" + deals + "]" +
                 ",\"positions\":[" + pos + "],\"positions_complete\":" + (np < MAX_POSITIONS ? "true" : "false") +
                 recon + path + "}";

   string resp = "";
   int code = Post(body, resp);
   if(code == 200 && StringFind(resp, "\"ok\":true") >= 0)
     {
      long ack = JsonLong(resp, "ack_server_msc");
      if(ack > g_ack) { g_ack = ack; GlobalVariableSet(GvAck(), (double)g_ack); }
      // drop the missing tickets we just sent, then add any newly requested ones
      if(usedMissing > 0) ArrayRemove(g_missing, 0, usedMissing);
      long req[];
      JsonLongArray(resp, "missing", req);
      for(int k = 0; k < ArraySize(req); k++) AddMissing(req[k]);
      if(reconcile) g_lastRecon = TimeLocal();
      if(nEv > 0) ArrayRemove(g_ev, 0, nEv);
      if(nEp > 0) ArrayRemove(g_epDone, 0, nEp);
      g_fails = 0;
      g_lastError = "";
      g_lastOkLocal = TimeLocal();
      g_lastSent = nDeals;
      g_dirty = more || ArraySize(g_missing) > 0 || ArraySize(g_ev) > 0;
      Status("OK | " + IntegerToString(nDeals) + " deal(s), " + IntegerToString(np) + " open position(s) sent" +
             (reconcile ? " | daily check done" : "") + (ArraySize(g_missing) > 0 ? " | catching up " + IntegerToString(ArraySize(g_missing)) + " missing deal(s)" : ""));
     }
   else
     {
      g_fails++;
      ulong wait = (ulong)MathMin(300.0, MathPow(2.0, MathMin(g_fails, 8))) * 1000;
      g_nextTryMs = GetTickCount64() + wait;
      g_lastError = ExplainFailure(code, resp);
      Status("NOT SENT: " + g_lastError + " | retry in " + IntegerToString((int)(wait / 1000)) + " s");
      if(g_fails == 3) Print("Trade Journal connector: ", g_lastError);
     }
  }

//+------------------------------------------------------------------+
//| Trade path (read-only): S/L changes and combined floating P&L     |
//+------------------------------------------------------------------+
void PathTick()
  {
   if(!InpTrackPath) return;
   long nowMs = (long)TimeTradeServer() * 1000;
   for(int i = 0; i < ArraySize(g_pt); i++) g_pt[i].seen = false;
   for(int g = 0; g < ArraySize(g_gr); g++) { g_gr[g].cur = 0; g_gr[g].live = false; }

   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      long   id   = PositionGetInteger(POSITION_IDENTIFIER);
      string sym  = PositionGetString(POSITION_SYMBOL);
      long   type = PositionGetInteger(POSITION_TYPE);
      double sl   = PositionGetDouble(POSITION_SL);
      double vol  = PositionGetDouble(POSITION_VOLUME);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      long   tOpen = PositionGetInteger(POSITION_TIME_MSC);
      double pt   = SymbolInfoDouble(sym, SYMBOL_POINT);
      if(pt <= 0) pt = 0.00001;

      //--- S/L or volume changed (or a new position): queue an event with the money at risk now
      int k = FindTrack(id);
      if(k < 0)
        {
         k = ArraySize(g_pt);
         ArrayResize(g_pt, k + 1, 32);
         g_pt[k].id = id; g_pt[k].sl = -1; g_pt[k].vol = -1;
        }
      g_pt[k].seen = true;
      if(MathAbs(sl - g_pt[k].sl) > pt / 2 || MathAbs(vol - g_pt[k].vol) > 1e-8)
        {
         g_pt[k].sl = sl; g_pt[k].vol = vol;
         QueueEvent("{\"position\":" + IntegerToString(id) + ",\"t\":" + IntegerToString(nowMs) +
                    ",\"sl\":" + DoubleToString(sl, Digits(sym)) + ",\"volume\":" + DoubleToString(vol, 8) +
                    ",\"risk\":" + RiskAtStop(type, sym, vol, open, sl) + "}");
        }

      //--- add this position's floating P&L to its symbol/side group
      int g = FindGroup(sym, type);
      if(g < 0)
        {
         g = ArraySize(g_gr);
         ArrayResize(g_gr, g + 1, 8);
         g_gr[g].sym = sym; g_gr[g].type = type; g_gr[g].start = tOpen; g_gr[g].ids = ",";
         g_gr[g].hasVal = false; g_gr[g].cur = 0; g_gr[g].live = false;
         g_gr[g].partial = (nowMs - tOpen > 15000);   // the connector wasn't running when it opened
        }
      if(tOpen < g_gr[g].start) g_gr[g].start = tOpen;
      if(StringFind(g_gr[g].ids, "," + IntegerToString(id) + ",") < 0) g_gr[g].ids += IntegerToString(id) + ",";
      g_gr[g].cur += PositionGetDouble(POSITION_PROFIT);
      g_gr[g].live = true;
     }

   //--- forget closed positions (their close comes from the deal history)
   int keep = 0;
   for(int i = 0; i < ArraySize(g_pt); i++) if(g_pt[i].seen) { if(keep != i) g_pt[keep] = g_pt[i]; keep++; }
   ArrayResize(g_pt, keep, 32);

   //--- update each group's lowest and highest value; finish groups with nothing open
   for(int g = ArraySize(g_gr) - 1; g >= 0; g--)
     {
      if(g_gr[g].live)
        {
         double v = g_gr[g].cur;
         if(!g_gr[g].hasVal || v < g_gr[g].mae) { g_gr[g].mae = v; g_gr[g].maeT = nowMs; }
         if(!g_gr[g].hasVal || v > g_gr[g].mfe) { g_gr[g].mfe = v; g_gr[g].mfeT = nowMs; }
         g_gr[g].hasVal = true;
        }
      else
        {
         if(g_gr[g].hasVal && ArraySize(g_epDone) < MAX_PATH_QUEUE)
           {
            int n = ArraySize(g_epDone);
            ArrayResize(g_epDone, n + 1, 16);
            g_epDone[n] = EpisodeJson(g, nowMs);
           }
         int last = ArraySize(g_gr) - 1;
         for(int j = g; j < last; j++) g_gr[j] = g_gr[j + 1];
         ArrayResize(g_gr, last, 8);
         g_dirty = true;
        }
     }
  }

int FindTrack(long id)
  {
   for(int i = 0; i < ArraySize(g_pt); i++) if(g_pt[i].id == id) return i;
   return -1;
  }

int FindGroup(string sym, long type)
  {
   for(int i = 0; i < ArraySize(g_gr); i++) if(g_gr[i].sym == sym && g_gr[i].type == type) return i;
   return -1;
  }

void QueueEvent(string json)
  {
   int n = ArraySize(g_ev);
   if(n >= MAX_PATH_QUEUE) { ArrayRemove(g_ev, 0, 1); n--; }
   ArrayResize(g_ev, n + 1, 64);
   g_ev[n] = json;
  }

// money lost if the position hit its S/L, from its entry ("0" if the S/L is at or past the entry, "null" if none)
string RiskAtStop(long type, string sym, double vol, double open, double sl)
  {
   if(sl <= 0 || vol <= 0) return "null";
   double p = 0;
   ENUM_ORDER_TYPE ot = (type == POSITION_TYPE_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(!OrderCalcProfit(ot, sym, vol, open, sl, p)) return "null";
   return (p < 0) ? DoubleToString(-p, 2) : "0";
  }

string EpisodeJson(int g, long endMs)
  {
   string ids = g_gr[g].ids;
   if(StringLen(ids) > 2) ids = StringSubstr(ids, 1, StringLen(ids) - 2); else ids = "";
   return "{\"symbol\":" + JsonStr(g_gr[g].sym) + ",\"type\":" + IntegerToString(g_gr[g].type) +
          ",\"start\":" + IntegerToString(g_gr[g].start) + ",\"end\":" + IntegerToString(endMs) +
          ",\"ids\":[" + ids + "]" +
          ",\"mae\":" + DoubleToString(g_gr[g].mae, 2) + ",\"mae_t\":" + IntegerToString(g_gr[g].maeT) +
          ",\"mfe\":" + DoubleToString(g_gr[g].mfe, 2) + ",\"mfe_t\":" + IntegerToString(g_gr[g].mfeT) +
          ",\"partial\":" + (g_gr[g].partial ? "1" : "0") + "}";
  }

//+------------------------------------------------------------------+
//| JSON pieces                                                       |
//+------------------------------------------------------------------+
string DealJson(ulong t)
  {
   string sym   = HistoryDealGetString(t, DEAL_SYMBOL);
   long   type  = HistoryDealGetInteger(t, DEAL_TYPE);
   long   entry = HistoryDealGetInteger(t, DEAL_ENTRY);
   double vol   = HistoryDealGetDouble(t, DEAL_VOLUME);
   double price = HistoryDealGetDouble(t, DEAL_PRICE);
   double sl    = HistoryDealGetDouble(t, DEAL_SL);
   double tp    = HistoryDealGetDouble(t, DEAL_TP);
   int dg = Digits(sym);

   // money at risk at the S/L, for entry deals (in the account currency)
   string risk = "null";
   if((entry == DEAL_ENTRY_IN || entry == DEAL_ENTRY_INOUT) && sl > 0 && vol > 0 && sym != "" &&
      (type == DEAL_TYPE_BUY || type == DEAL_TYPE_SELL))
     {
      double p = 0;
      ENUM_ORDER_TYPE ot = (type == DEAL_TYPE_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      if(OrderCalcProfit(ot, sym, vol, price, sl, p) && p < 0) risk = DoubleToString(-p, 2);
     }

   return "{\"ticket\":" + IntegerToString((long)t) +
          ",\"order\":" + IntegerToString(HistoryDealGetInteger(t, DEAL_ORDER)) +
          ",\"position\":" + IntegerToString(HistoryDealGetInteger(t, DEAL_POSITION_ID)) +
          ",\"time\":" + IntegerToString(HistoryDealGetInteger(t, DEAL_TIME_MSC)) +
          ",\"type\":" + IntegerToString(type) +
          ",\"entry\":" + IntegerToString(entry) +
          ",\"symbol\":" + JsonStr(sym) +
          ",\"volume\":" + DoubleToString(vol, 8) +
          ",\"price\":" + DoubleToString(price, dg) +
          ",\"profit\":" + DoubleToString(HistoryDealGetDouble(t, DEAL_PROFIT), 2) +
          ",\"commission\":" + DoubleToString(HistoryDealGetDouble(t, DEAL_COMMISSION), 2) +
          ",\"swap\":" + DoubleToString(HistoryDealGetDouble(t, DEAL_SWAP), 2) +
          ",\"fee\":" + DoubleToString(HistoryDealGetDouble(t, DEAL_FEE), 2) +
          ",\"sl\":" + DoubleToString(sl, dg) +
          ",\"tp\":" + DoubleToString(tp, dg) +
          ",\"risk\":" + risk +
          ",\"magic\":" + IntegerToString(HistoryDealGetInteger(t, DEAL_MAGIC)) +
          ",\"reason\":" + IntegerToString(HistoryDealGetInteger(t, DEAL_REASON)) +
          ",\"comment\":" + JsonStr(HistoryDealGetString(t, DEAL_COMMENT)) + "}";
  }

// the position selected by PositionGetTicket()
string PositionJson()
  {
   string sym  = PositionGetString(POSITION_SYMBOL);
   long   type = PositionGetInteger(POSITION_TYPE);
   double vol  = PositionGetDouble(POSITION_VOLUME);
   double open = PositionGetDouble(POSITION_PRICE_OPEN);
   double sl   = PositionGetDouble(POSITION_SL);
   int dg = Digits(sym);
   string risk = "null";
   if(sl > 0 && vol > 0)
     {
      double p = 0;
      ENUM_ORDER_TYPE ot = (type == POSITION_TYPE_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      if(OrderCalcProfit(ot, sym, vol, open, sl, p) && p < 0) risk = DoubleToString(-p, 2);
     }
   return "{\"position\":" + IntegerToString(PositionGetInteger(POSITION_IDENTIFIER)) +
          ",\"symbol\":" + JsonStr(sym) +
          ",\"type\":" + IntegerToString(type) +
          ",\"volume\":" + DoubleToString(vol, 8) +
          ",\"price\":" + DoubleToString(open, dg) +
          ",\"time\":" + IntegerToString(PositionGetInteger(POSITION_TIME_MSC)) +
          ",\"sl\":" + DoubleToString(sl, dg) +
          ",\"tp\":" + DoubleToString(PositionGetDouble(POSITION_TP), dg) +
          ",\"profit\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) +
          ",\"swap\":" + DoubleToString(PositionGetDouble(POSITION_SWAP), 2) +
          ",\"risk\":" + risk +
          ",\"magic\":" + IntegerToString(PositionGetInteger(POSITION_MAGIC)) +
          ",\"comment\":" + JsonStr(PositionGetString(POSITION_COMMENT)) + "}";
  }

int Digits(string sym)
  {
   if(sym == "") return 8;
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   return (dg <= 0 ? 8 : dg);
  }

string JsonStr(string s)
  {
   string out = "\"";
   int n = StringLen(s);
   for(int i = 0; i < n; i++)
     {
      ushort c = StringGetCharacter(s, i);
      if(c == '"')       out += "\\\"";
      else if(c == '\\') out += "\\\\";
      else if(c == '\n') out += "\\n";
      else if(c == '\r') out += "\\r";
      else if(c == '\t') out += "\\t";
      else if(c < 32)    out += " ";
      else               out += ShortToString(c);
     }
   return out + "\"";
  }

//+------------------------------------------------------------------+
//| HTTP                                                              |
//+------------------------------------------------------------------+
int Post(string body, string &resp)
  {
   char data[], result[];
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(data, len - 1);           // drop the trailing 0
   string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + InpToken + "\r\n";
   if(InpAccessId != "" && InpAccessSecret != "")
      headers += "CF-Access-Client-Id: " + InpAccessId + "\r\nCF-Access-Client-Secret: " + InpAccessSecret + "\r\n";
   string rh = "";
   ResetLastError();
   int code = WebRequest("POST", InpUrl, headers, 15000, data, result, rh);
   resp = (ArraySize(result) > 0) ? CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8) : "";
   if(code == -1) resp = "#err" + IntegerToString(GetLastError());
   return code;
  }

string ExplainFailure(int code, string resp)
  {
   if(code == -1)
     {
      if(resp == "#err4014")
         return "MT5 blocks the web address. Tools -> Options -> Expert Advisors -> tick 'Allow WebRequest for listed URL' and add " + BaseUrl();
      if(resp == "#err5200") return "the URL is not valid: " + InpUrl;
      if(resp == "#err5201") return "couldn't connect to " + BaseUrl() + " (internet, firewall or antivirus?)";
      if(resp == "#err5202") return "the journal didn't answer in 15 s";
      return "no connection to the journal (error " + StringSubstr(resp, 4) + ")";
     }
   if(code >= 1000 && code < 2000)
     {
      // MT5's own WebRequest errors (not from the web site). The reply text, if any, says why.
      string why = StringSubstr(resp, 0, 160);
      StringReplace(why, "\r", " ");
      StringReplace(why, "\n", " ");
      Print("Trade Journal connector: WebRequest internal error ", code, " (last error ", GetLastError(), "). Reply: '", why, "'");
      return "MT5 web error " + IntegerToString(code) + ". Usually Cloudflare Access is redirecting to its login page " +
             "(the Bypass rule for /api/ingest isn't working). Test: open " + BaseUrl() + "/api/ingest in a private browser window";
     }
   if(StringFind(resp, "<html") >= 0 || StringFind(resp, "<!DOCTYPE") >= 0 || code == 302 || code == 303)
      return "Cloudflare Access sent a login page. Add the Bypass rule for /api/ingest (README -> Login)";
   if(code == 403 && StringFind(resp, "\"error\"") < 0)
      return "HTTP 403 from Cloudflare (bot protection or WAF?). See README -> Troubleshooting";
   string err = JsonString(resp, "error");
   if(err == "") err = "HTTP " + IntegerToString(code);
   return err;
  }

string BaseUrl()
  {
   int p = StringFind(InpUrl, "/", 8);
   return (p > 0) ? StringSubstr(InpUrl, 0, p) : InpUrl;
  }

//--- tiny JSON readers for the journal's reply
long JsonLong(string s, string key)
  {
   int p = StringFind(s, "\"" + key + "\":");
   if(p < 0) return 0;
   p += StringLen(key) + 3;
   string num = "";
   while(p < StringLen(s))
     {
      ushort c = StringGetCharacter(s, p);
      if((c >= '0' && c <= '9') || c == '-') num += ShortToString(c); else break;
      p++;
     }
   return StringToInteger(num);
  }

string JsonString(string s, string key)
  {
   int p = StringFind(s, "\"" + key + "\":\"");
   if(p < 0) return "";
   p += StringLen(key) + 4;
   int e = StringFind(s, "\"", p);
   return (e > p) ? StringSubstr(s, p, e - p) : "";
  }

void JsonLongArray(string s, string key, long &out[])
  {
   ArrayResize(out, 0);
   int p = StringFind(s, "\"" + key + "\":[");
   if(p < 0) return;
   p += StringLen(key) + 4;
   int e = StringFind(s, "]", p);
   if(e <= p) return;
   string parts[];
   int n = StringSplit(StringSubstr(s, p, e - p), ',', parts);
   for(int i = 0; i < n; i++)
     {
      long v = StringToInteger(parts[i]);
      if(v > 0) { int k = ArraySize(out); ArrayResize(out, k + 1); out[k] = v; }
     }
  }

void AddMissing(long t)
  {
   for(int i = 0; i < ArraySize(g_missing); i++) if(g_missing[i] == t) return;
   int n = ArraySize(g_missing);
   if(n >= 5000) return;
   ArrayResize(g_missing, n + 1, 64);
   g_missing[n] = t;
  }

//+------------------------------------------------------------------+
//| Status on the chart                                               |
//+------------------------------------------------------------------+
string MaskedLogin()
  {
   string s = IntegerToString(g_login);
   return (StringLen(s) > 4) ? "***" + StringSubstr(s, StringLen(s) - 4) : s;
  }

void Status(string msg)
  {
   g_status = msg;
   if(!InpShowStatus) return;
   string last = (g_lastOkLocal > 0) ? TimeToString(g_lastOkLocal, TIME_DATE | TIME_SECONDS) + " (PC time)" : "never";
   Comment("Trade Journal connector " + CONNECTOR_VERSION + " | READ-ONLY | account " + MaskedLogin() + "\n" +
           "Last successful sync: " + last + "\n" + g_status);
  }
//+------------------------------------------------------------------+
