"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import { getApiUrl } from "@/utils/platform";
import {
  Loader2,
  FileX,
  CheckCircle,
  Image as ImageIcon,
  FileDown,
  MessageSquare,
  Printer,
  Share2,
} from "lucide-react";

interface DetalhesViewProps {
  readonly id: string;
  readonly documentType?: "aviso" | "recibo";
}

/**
 * Visualizador de PDF com fallback para mobile/Capacitor.
 * Em iOS/Android/WebView, iframes com PDF geralmente não renderizam —
 * então mostramos um card com botão grande para abrir o arquivo.
 */
function PdfViewer({ url, onAbrir }: { readonly url: string; readonly onAbrir: (e: React.MouseEvent) => void }) {
  const [iframeFalhou, setIframeFalhou] = useState(false);

  const ehMobile = (() => {
    if (globalThis.window === undefined) return false;
    const w = globalThis.window as any;
    if (w.Capacitor?.isNativePlatform?.()) return true;
    const ua = globalThis.navigator?.userAgent || "";
    return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  })();

  // Em mobile/Capacitor, iframe de PDF não funciona — mostra CTA direto
  if (ehMobile || iframeFalhou) {
    return (
      <div className="bg-white p-6 sm:p-8 rounded-xl shadow-sm max-w-xl w-full border border-gray-200 flex flex-col items-center text-center">
        <div className="bg-green-50 p-4 rounded-full mb-4">
          <FileDown size={48} className="text-[#057321]" />
        </div>
        <h2 className="text-lg font-bold text-gray-800 mb-2">
          Comprovante em PDF
        </h2>
        <p className="text-sm text-gray-600 mb-5">
          Toque no botão abaixo para abrir o PDF com os dados da correspondência.
        </p>
        <a
          href={url}
          onClick={onAbrir}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-[#057321] hover:bg-[#04601c] text-white font-semibold px-6 py-3 rounded-full shadow-md transition w-full sm:w-auto justify-center"
        >
          <FileDown size={18} />
          Abrir PDF
        </a>
        <p className="text-xs text-gray-400 mt-4 break-all">
          Se o PDF não abrir, copie este link: <br />
          <span className="font-mono">{url}</span>
        </p>
      </div>
    );
  }

  // Desktop: tenta iframe, com detecção de falha
  return (
    <iframe
      src={url}
      className="w-full h-[80vh] bg-white"
      title="Comprovante PDF"
      onError={() => setIframeFalhou(true)}
    />
  );
}

export default function DetalhesView({ id, documentType }: DetalhesViewProps) {
  const [loading, setLoading] = useState(true);
  const [dados, setDados] = useState<any>(null);
  const [erro, setErro] = useState("");
  const [isImage, setIsImage] = useState(false);
  const [isPdf, setIsPdf] = useState(false);
  const [isTextOnly, setIsTextOnly] = useState(false);
  const [statusAcao, setStatusAcao] = useState("");

  const mostrarStatusAcao = (mensagem: string) => {
    setStatusAcao(mensagem);
    globalThis.window.setTimeout(() => {
      setStatusAcao((atual) => (atual === mensagem ? "" : atual));
    }, 2500);
  };

  const resolverUrlPublica = async (recordId: string, fallbackUrl: string) => {
    try {
      const params = new URLSearchParams({ id: recordId });
      if (documentType) {
        params.set("type", documentType);
      }

      const response = await fetch(`${getApiUrl("/api/public-document")}?${params.toString()}`);
      if (!response.ok) {
        return fallbackUrl;
      }

      const result = await response.json();
      return result?.url || fallbackUrl;
    } catch {
      return fallbackUrl;
    }
  };

  const colecoesPublicas = ["correspondencias", "avisos_rapidos"];

  const buscarDocumento = async (colecao: string, idLimpo: string) => {
    try {
      const { data, error } = await supabase
        .from(colecao)
        .select("*")
        .eq("id", idLimpo)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null; // Not found
        console.warn(`⚠️ Erro ao consultar ${colecao}:`, error.message);
        return null;
      }

      if (data) {
        // Map snake_case → camelCase for display fields
        return {
          dados: {
            ...data,
            moradorNome: data.morador_nome ?? data.moradorNome,
            moradorId: data.morador_id ?? data.moradorId,
            imagemUrl: data.imagem_url ?? data.imagemUrl,
            pdfUrl: data.pdf_url ?? data.pdfUrl,
            reciboUrl: data.recibo_url ?? data.reciboUrl,
            fotoUrl: data.foto_url ?? data.fotoUrl,
            dadosRetirada: data.dados_retirada ?? data.dadosRetirada,
          },
          colecao,
        };
      }
      return null;
    } catch (error: any) {
      console.warn(`⚠️ Erro ao consultar ${colecao}:`, error.message);
      return null;
    }
  };

  const buscarPorId = async (idLimpo: string) => {
    for (const colecao of colecoesPublicas) {
      const resultado = await buscarDocumento(colecao, idLimpo);
      if (resultado) {
        return resultado;
      }
    }
    return null;
  };

  const analisarTipoArquivo = (urlArquivo: string) => {
    const urlLower = urlArquivo.toLowerCase();
    const ehPdf =
      urlLower.includes(".pdf") ||
      urlLower.includes("application/pdf") ||
      urlLower.includes("alt=media&token") ||
      urlLower.includes("/api/public-document");
    const ehImagem = !ehPdf && (urlLower.includes(".jpg") || urlLower.includes(".jpeg") || urlLower.includes(".png") || urlLower.includes("image/"));
    return { ehPdf, ehImagem };
  };

  useEffect(() => {
    console.log("🚀 [DetalhesView] Iniciando. ID recebido:", id);

    const buscar = async () => {
      try {
        setLoading(true);
        setErro("");

        if (!id || id === "undefined" || id === "null") {
          console.error("❌ ID inválido recebido.");
          setErro("Código de identificação inválido.");
          setLoading(false);
          return;
        }

        const idLimpo = decodeURIComponent(id)
          .split("/")
          .pop()
          ?.replaceAll("}", "")
          .replaceAll("%7D", "")
          .trim() || id;

        console.log("🔍 Buscando no banco pelo ID:", idLimpo);

        const resultado = await buscarPorId(idLimpo);

        if (!resultado) {
          console.warn("⚠️ Registro não encontrado em nenhuma coleção.");
          setErro("Registro não encontrado no sistema.");
          return;
        }

        const dadosEncontrados = resultado.dados;
        console.log(`✅ Registro encontrado em [${resultado.colecao}]:`, dadosEncontrados);

        const urlArquivo =
          dadosEncontrados?.reciboUrl ||
          dadosEncontrados?.dadosRetirada?.reciboUrl ||
          dadosEncontrados?.pdfUrl ||
          dadosEncontrados?.fotoUrl ||
          dadosEncontrados?.imagemUrl ||
          "";

        const textoMensagem = 
          dadosEncontrados?.mensagem || 
          dadosEncontrados?.observacao || 
          dadosEncontrados?.descricao || 
          "";

        const temMensagem = !!textoMensagem;
        const temArquivo = !!urlArquivo;

        if (!temArquivo && !temMensagem) {
          setErro("O arquivo para este registro ainda não foi gerado.");
          return;
        }

        const urlResolvida = temArquivo
          ? await resolverUrlPublica(idLimpo, String(urlArquivo))
          : "";

        const urlParaAnalise = [
          String(dadosEncontrados?.reciboUrl || ""),
          String(dadosEncontrados?.pdfUrl || ""),
          String(dadosEncontrados?.fotoUrl || ""),
          String(dadosEncontrados?.imagemUrl || ""),
          String(urlResolvida || ""),
          String(urlArquivo || ""),
        ].find(Boolean) || "";

        const { ehPdf, ehImagem } = temArquivo
          ? analisarTipoArquivo(urlParaAnalise)
          : { ehPdf: false, ehImagem: false };

        setIsPdf(ehPdf);
        setIsImage(ehImagem);
        setIsTextOnly(!temArquivo && temMensagem);

        setDados({
          ...dadosEncontrados,
          mensagem: textoMensagem, // Garante que a mensagem vá para o campo certo
          urlFinal: urlResolvida || urlArquivo,
          moradorNome: dadosEncontrados?.moradorNome || dadosEncontrados?.destinatario || "Morador",
        });

      } catch (e) {
        console.error("❌ Erro fatal na busca:", e);
        setErro("Erro técnico ao carregar o documento.");
      } finally {
        // Garante que o loading pare aconteça o que acontecer
        setLoading(false);
      }
    };

    buscar();
  }, [id, documentType]);

  const handleAbrirArquivo = (e: React.MouseEvent) => {
    if (!dados?.urlFinal) return;
    const isCapacitor = globalThis.window !== undefined && (globalThis.window as any).Capacitor;
    if (isCapacitor) {
        e.preventDefault();
        globalThis.window.open(dados.urlFinal, "_system");
    }
  };

  const handleCompartilhar = async () => {
    const urlCompartilhamento = dados?.urlFinal || globalThis.window.location.href;
    const payload = {
      title: getHeaderTitle(),
      text: `Protocolo #${dados?.protocolo ?? "-"}`,
      url: urlCompartilhamento,
    };

    try {
      if (globalThis.navigator.share) {
        await globalThis.navigator.share(payload);
        return;
      }

      await globalThis.navigator.clipboard.writeText(urlCompartilhamento);
      mostrarStatusAcao("Link copiado para compartilhamento.");
    } catch {
      mostrarStatusAcao("Nao foi possivel compartilhar agora.");
    }
  };

  const handleImprimir = () => {
    if (isTextOnly || !dados?.urlFinal) {
      globalThis.window.print();
      return;
    }

    const janelaImpressao = globalThis.window.open(dados.urlFinal, "_blank");
    if (!janelaImpressao) {
      mostrarStatusAcao("Libere pop-ups para imprimir o documento.");
      return;
    }

    janelaImpressao.addEventListener("load", () => {
      janelaImpressao.focus();
      janelaImpressao.print();
    }, { once: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-gray-500 gap-3">
        <Loader2 size={40} className="animate-spin text-[#057321]" />
        <p>Localizando documento...</p>
        {/* Mostra ID para debug se demorar muito */}
        <p className="text-xs text-gray-300 font-mono mt-4">ID: {id}</p>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-lg text-center max-w-md w-full">
          <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <FileX className="text-red-600" size={32} />
          </div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">
            Não Disponível
          </h1>
          <p className="text-gray-600">{erro}</p>
          <p className="text-xs text-gray-400 mt-4">ID: {id}</p>
        </div>
      </div>
    );
  }

  const getHeaderTitle = () => {
    if (isImage) return "Foto do Aviso";
    if (isTextOnly) return "Mensagem do Condomínio";
    return "Recibo Digital";
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <header className="bg-[#057321] text-white py-4 px-5 sm:px-6 shadow-md flex items-center gap-3">
        <div className="bg-white p-1.5 rounded-full shadow-sm">
          {isTextOnly ? (
            <MessageSquare className="text-[#057321]" size={20} />
          ) : (
            <CheckCircle className="text-[#057321]" size={20} />
          )}
        </div>
        <div className="min-w-0">
          <h1 className="font-bold text-lg leading-none truncate">
            {getHeaderTitle()}
          </h1>
          <p className="text-xs text-green-100 mt-0.5 truncate">
            Protocolo: #{dados?.protocolo ?? "-"}
          </p>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start p-3 sm:p-6">
        <div className="w-full max-w-5xl bg-white rounded-xl shadow-xl overflow-hidden flex flex-col border border-gray-200">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex justify-between items-center gap-3">
            <span className="text-sm text-gray-600 font-medium truncate">
              Documento validado para visualização pública
            </span>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCompartilhar}
                className="inline-flex items-center gap-2 rounded-full border border-[#057321]/20 bg-white px-3 py-2 text-xs font-semibold text-[#057321] transition hover:bg-[#057321]/5"
              >
                <Share2 size={14} />
                Compartilhar
              </button>

              <button
                type="button"
                onClick={handleImprimir}
                className="inline-flex items-center gap-2 rounded-full bg-[#057321] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#04601c]"
              >
                <Printer size={14} />
                Imprimir
              </button>

              {!isTextOnly && dados?.urlFinal && (
                <a
                  href={dados.urlFinal}
                  onClick={handleAbrirArquivo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-[#057321] hover:underline uppercase tracking-wide flex items-center gap-1 whitespace-nowrap cursor-pointer"
                >
                  {isImage ? <ImageIcon size={14} /> : <FileDown size={14} />}
                  Abrir {isImage ? "Imagem" : "PDF"}
                </a>
              )}
            </div>
          </div>

          {statusAcao && (
            <div className="border-b border-gray-200 bg-green-50 px-4 py-2 text-sm font-medium text-[#057321]">
              {statusAcao}
            </div>
          )}

          <div className="flex-1 bg-black/5 overflow-auto flex items-center justify-center p-2 min-h-[60vh]">
            
            {/* MENSAGEM DE TEXTO */}
            {isTextOnly && (
              <div className="bg-white p-8 rounded-xl shadow-sm max-w-2xl w-full border border-gray-200 flex flex-col items-center text-center">
                <div className="bg-green-50 p-4 rounded-full mb-4">
                   <MessageSquare size={48} className="text-[#057321]" />
                </div>
                <h2 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2 w-full">
                  Comunicado
                </h2>
                <div className="text-gray-700 text-lg leading-relaxed whitespace-pre-wrap text-left w-full">
                  {dados?.mensagem?.replaceAll(/<br\s*\/?>/gi, '\n') || "Sem conteúdo."}
                </div>
              </div>
            )}

            {/* IMAGEM */}
            {isImage && (
              <img
                src={dados.urlFinal}
                alt="Comprovante"
                className="max-w-full max-h-[75vh] object-contain shadow-lg rounded-md"
              />
            )}

            {/* PDF */}
            {isPdf && (
              <PdfViewer url={dados.urlFinal} onAbrir={handleAbrirArquivo} />
            )}

            {!isImage && !isPdf && !isTextOnly && (
              <div className="text-sm text-gray-500 p-6">
                Não foi possível detectar o tipo do arquivo.
              </div>
            )}
          </div>
        </div>

        <p className="mt-4 text-xs text-gray-400">
          Sistema de Gestão de Correspondências
        </p>
      </main>
    </div>
  );
}
