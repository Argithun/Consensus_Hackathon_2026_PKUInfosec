import { createBrowserClient } from '@supabase/ssr'

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default supabase

export type Book = {
  id?: string;
  name: string;
  author: string;
  introduction: string;
  count: number;
};

export const createBook = async (book: Book) => {
  const { data, error } = await supabase.from('books').insert(book)
  if (error) {
    console.error(error)
    throw error
  }
  return data
}

export const getBooks = async () => {
  const { data: books, error } = await supabase.from('books').select()
  if (error) {
    console.error(error)
    throw error
  }
  return books
}

export const updateBook = async (book: Book) => {
  const { error } = await supabase.from('books').update(book).eq('id', book.id)
  if (error) {
    console.error(error)
    throw error
  }
  return book
}

export const deleteBook = async (id: string) => {
  const { error } = await supabase.from('books').delete().eq('id', id)
  if (error) {
    console.error(error)
    throw error
  }
  return id
}

export const uploadFile = async (file: File) => {
  const { data, error } = await supabase.storage.from('books').upload('public/' + file.name, file)
  if (error) {
    console.error(error)
    throw error
  }
  return data
}

export const getFileUrl = async (path: string) => {
  const { data } = await supabase.storage.from('books').getPublicUrl(path)
  return data.publicUrl
}