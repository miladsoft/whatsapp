﻿using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace BaileysCSharp.Core.Types
{
    internal class MessageReceiptType
    {
        public const string Read = "read";
        public const string ReadSelf = "read-self";
        public const string HistSync = "hist_sync";
        public const string PeerMsg = "peer_msg";
        public const string Sender = "sender";
        public const string Inactive = "inactive";
        public const string Played = "played";
        public const string Undefined = "";
    }
}
