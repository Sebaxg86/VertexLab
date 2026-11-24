using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Xml.Linq;
namespace VertexLab.Desktop;

internal static class BrandImages
{
    static readonly Dictionary<string, ImageSource?> cache = [];
    public static ImageSource? Load(string? path)
    {
        if (path is null) return null; if (cache.TryGetValue(path, out var existing)) return existing; ImageSource? image = null;
        try
        {
            if (!path.EndsWith(".svg", StringComparison.OrdinalIgnoreCase)) image = new BitmapImage(new Uri(path));
            else
            {
                var document = XDocument.Load(path);
                var complex = document.Descendants().Any(e => e.Attribute("transform") is not null || e.Name.LocalName is "circle" or "ellipse" or "polygon" or "rect" or "text");
                if (complex) { string fallback = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(path)!, System.IO.Path.GetFileName(path).Replace("emblem-", "brand-").Replace(".svg", ".png")); if (System.IO.File.Exists(fallback)) return cache[path] = Load(fallback); }
                var drawing = new DrawingGroup();
                foreach (var item in document.Descendants().Where(e => e.Name.LocalName == "path"))
                {
                    var data = item.Attribute("d")?.Value; if (string.IsNullOrWhiteSpace(data)) continue;
                    var geometry = PathGeometry.CreateFromGeometry(Geometry.Parse(data)); geometry.FillRule = item.Attribute("fill-rule")?.Value == "evenodd" ? FillRule.EvenOdd : FillRule.Nonzero;
                    string color = item.Attribute("fill")?.Value ?? "white"; Brush? fill = color == "none" ? null : (Brush)new BrushConverter().ConvertFromString(color)!;
                    Pen? pen = null; if (item.Attribute("stroke")?.Value is { } stroke && stroke != "none") pen = new Pen((Brush)new BrushConverter().ConvertFromString(stroke)!, double.TryParse(item.Attribute("stroke-width")?.Value, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var width) ? width : 1);
                    drawing.Children.Add(new GeometryDrawing(fill, pen, geometry));
                }
                drawing.Freeze(); image = new DrawingImage(drawing);
            }
            image?.Freeze();
        }
        catch { image = null; }
        cache[path] = image; return image;
    }
}
